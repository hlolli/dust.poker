// The proof gate: plays deals through the contract locally until every circuit has run once,
// then proves each of those calls with Midnight's wasm prover and checks the proof verified.
// Fails (exit 1) on any circuit that is not covered or does not prove.
//
//   bun run compact:build --zk && bun scripts/prove-deal.ts
//
// Needs .compact/prover (scripts/build-prover.sh) and the prover keys under contracts/build.
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { CALL, CIRCUITS, type Circuit, Phase, RAISE, seatsOf, Table } from "../contracts/harness.ts";

const root = `${import.meta.dir}/..`;
const { values: args } = parseArgs({
  options: {
    "zkir-wasm": { type: "string", default: `${root}/.compact/prover/zkir-wasm` },
    keys: { type: "string", default: `${root}/contracts/build/deal/keys` },
    zkir: { type: "string", default: `${root}/contracts/build/deal/zkir` },
    params: { type: "string", default: `${root}/.compact/prover/params` },
    // Only these circuits (comma-separated); default: every one.
    circuits: { type: "string" },
  },
});
const PARAMS_URL = "https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com/bls_midnight_2p";

// ---- Play until every circuit has a preimage ----------------------------------------------

const preimages = new Map<Circuit, Uint8Array>();
const collect = (t: Table) => {
  for (const [c, p] of t.preimages) if (!preimages.has(c)) preimages.set(c, p);
};

// A heads-up deal to showdown, with the next deck prepared alongside; then a buy-in and a leave.
{
  const t = await Table.seated(2);
  await t.dealt();
  await t.prepare();
  await t.checkAndRelease(); // preflop call and check, the flop released
  const l = t.ledger;
  const s = Number(l.to_act);
  await t.call(s, "act_out", BigInt(s), RAISE, l.bet[s]! + l.stack[s]!); // shoves
  const o = Number(t.ledger.to_act);
  await t.call(o, "act_out", BigInt(o), CALL, 0n); // called: everyone all in
  await t.tableAll();
  await t.showAll();
  await t.call(0, "settle");
  const broke = seatsOf(t.ledger).find((i) => t.ledger.stack[i] === 0n)!;
  await t.call(broke, "buy_in", BigInt(broke), 200n);
  await t.call(1 - broke, "stand_up", BigInt(1 - broke), true);
  await t.call(1 - broke, "leave", BigInt(1 - broke));
  collect(t);
}

// A deal aborted in the keys phase and settled; then a preparation step missed.
{
  const t = await Table.seated(3);
  await t.call(0, "start_deal");
  await t.call(0, "post_key", 0n);
  await t.call(2, "post_key", 2n);
  t.now += 80; // the 60 s keys budget after the 20 s clock slack
  await t.call(2, "expire");
  await t.call(2, "settle_abort");
  if (t.ledger.phase !== Phase.done) throw new Error("the abort did not settle");
  collect(t);
}
{
  const t = await Table.seated(3);
  await t.dealt();
  await t.foldOut();
  await t.call(0, "post_next_key", 0n);
  await t.call(2, "post_next_key", 2n);
  t.now += 200; // the 180 s preparation budget after the slack
  await t.call(2, "expire_next");
  collect(t);
}

const wanted = (args.circuits?.split(",") as Circuit[] | undefined) ?? CIRCUITS;
const missing = wanted.filter((c) => !preimages.has(c));
if (missing.length) {
  console.error(`no preimage for: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`${preimages.size} circuits ran; proving ${wanted.length}`);

// ---- Prove each one -----------------------------------------------------------------------

const zkir = await import(`${args["zkir-wasm"]}/midnight_zkir_wasm_fs.js`);
const kmProvider = {
  async lookupKey(keyLocation: string) {
    const read = (p: string) => Bun.file(p).bytes();
    return {
      proverKey: await read(`${args.keys}/${keyLocation}.prover`),
      verifierKey: await read(`${args.keys}/${keyLocation}.verifier`),
      ir: zkir.jsonIrToBinary(await Bun.file(`${args.zkir}/${keyLocation}.zkir`).text()),
    };
  },
  async getParams(k: number) {
    await mkdir(args.params!, { recursive: true });
    const file = `${args.params}/bls_midnight_2p${k}`;
    if (!existsSync(file)) {
      const res = await fetch(`${PARAMS_URL}${k}`);
      if (!res.ok) throw new Error(`params k=${k}: ${res.status}`);
      await Bun.write(file, await res.arrayBuffer());
    }
    return Bun.file(file).bytes();
  },
};

let failed = 0;
const started = performance.now();
for (const circuit of wanted) {
  const t0 = performance.now();
  try {
    // The prover verifies every proof it makes before returning, so a returned proof is a valid one.
    const proof: Uint8Array = await zkir.prove(preimages.get(circuit)!, kmProvider);
    console.log(`  ${circuit.padEnd(14)} proof ${proof.length} bytes in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    failed++;
    console.error(`  ${circuit.padEnd(14)} FAILED: ${e instanceof Error ? e.message : e}`);
  }
}
console.log(`${wanted.length - failed} of ${wanted.length} proved in ${((performance.now() - started) / 1000).toFixed(0)} s`);
process.exit(failed ? 1 : 0);
