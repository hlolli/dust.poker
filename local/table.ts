// A Live table on the local network without Lace: two wallets driven from seeds open a table,
// take two seats and play a deal, through the same code the site runs (src/live). Each step is
// a real transaction: proven by the local proof server, balanced and signed by the wallet SDK,
// submitted to the node, read back through the indexer. The end-to-end check of the Live table.
//
//   bun local/table.ts                        # seeds 00..02 and 00..03, both genesis wallets
//   bun local/table.ts --table <hex>          # join an existing table instead of opening one
//   bun local/table.ts --table <hex> --sit 3  # one wallet (seed 3) sits down and plays along,
//                                             # checking or folding, until stopped: an opponent
//                                             # for a player in the browser (local/bridge.ts)
//
// Needs the stack from local/compose.yml and the keys from `bun run compact:build --zk`.
// The default check plays every street to showdown and withdraws both stacks and bonds.
import { parseArgs } from "node:util";
import { strict as assert } from "node:assert";
import { ContractState } from "@midnight-ntwrk/compact-runtime";
import { ledger } from "../contracts/build/deal/contract/index.js";
import { callOn } from "../src/live/chain.ts";
import { Phase } from "../src/referee/rules.ts";
import { config, root, scriptWallet, seed } from "./wallet.ts";

const live = await import(`${root}/src/live/live.ts`);
const { LiveReferee } = await import(`${root}/src/live/referee.ts`);
const { snapshot } = await import(`${root}/src/live/indexer.ts`);
type TableState = import("../src/referee/types.ts").TableState;
type KeyStore = import("../src/live/referee.ts").KeyStore;
type Profile = import("../src/ui/profiles.ts").Profile;

/** A profile whose table identity follows from the seed, so a rerun against the same table takes the same seat back. */
const profile = (name: string, seedHex: string): Profile => ({ id: name, name, look: { model: 0, skin: 0.5, hair: "#000000", outfit: "#000000", height: 1 } as Profile["look"], secret: String(BigInt(`0x${seedHex}`)) });
const memoryStore = (): KeyStore => {
  let kept: ReturnType<KeyStore["load"]> = null;
  return { load: () => kept, save: (k) => (kept = k) };
};

/** Waits for a table state that satisfies `ok`. */
const until = (ref: InstanceType<typeof LiveReferee>, ok: (s: TableState) => boolean, ms = 300_000) =>
  new Promise<TableState>((resolve, reject) => {
    let last: TableState | null = null;
    let off = () => {};
    let done = false;
    const timer = setTimeout(() => (off(), reject(new Error(`timed out: "${last?.message}", street ${last?.street}`))), ms);
    off = ref.subscribe((s: TableState) => {
      last = s;
      if (ok(s)) (done = true, clearTimeout(timer), off(), resolve(s));
    });
    if (done) off();
  });

async function waitFor(ok: () => Promise<boolean>, what: string, ms = 180_000) {
  const deadline = Date.now() + ms;
  let last: unknown;
  while (Date.now() < deadline) {
    try { if (await ok()) return; } catch (e) { last = e; }
    await Bun.sleep(2000);
  }
  throw new Error(`timed out waiting for ${what}`, { cause: last });
}

async function ready() {
  await waitFor(async () => {
    const response = await fetch("http://127.0.0.1:9944", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "midnight_ledgerVersion", params: [] }), signal: AbortSignal.timeout(5000) });
    const version = await response.json() as { result?: string; error?: unknown };
    assert.match(String(version.result), /ledger.?9/i);
    const snap = await snapshot(config.indexerUri, "00".repeat(32));
    const proof = await fetch("http://127.0.0.1:6300/health", { signal: AbortSignal.timeout(5000) });
    return snap.block.height > 1 && proof.ok;
  }, "Ledger 9 node, indexer, and proof server");
}

/** One wallet at an existing table, playing along for as long as the process runs. */
async function sit(address: string, n: number) {
  const s = seed(n);
  const w = await scriptWallet(`seed ${n}`, s, (l) => console.log(`  ${l}`));
  console.log(`seed ${n} ${w.address} takes a seat at ${address.slice(0, 12)}...`);
  const j = await live.joinTable(w, profile(`Seed ${n}`, s), address);
  console.log(`  seat ${j.seat.index}`);
  const ref = new LiveReferee(j.chain, j.seat, { betweenDeals: 1000, store: memoryStore() });
  let last = "";
  let acting = false;
  ref.subscribe((state: TableState) => {
    if (state.message !== last) console.log(`  [seed ${n}] ${state.message || "(playing)"}`);
    last = state.message;
    if (state.legal && !acting) {
      acting = true;
      const action = state.legal.check ? { type: "check" as const } : { type: "fold" as const };
      console.log(`  [seed ${n}] ${action.type}s`);
      ref.act(action).catch((e: unknown) => console.log(`  [seed ${n}] could not act: ${e instanceof Error ? e.message : e}`)).finally(() => (acting = false));
    }
  });
  ref.start();
  await new Promise(() => {}); // until stopped
}

async function main() {
  const { values } = parseArgs({ options: { table: { type: "string" }, sit: { type: "string" } } });
  await ready();
  if (values.sit) return sit(values.table!, Number(values.sit));
  const [seedA, seedB] = [seed(2), seed(3)];
  const [alice, bob] = await Promise.all([scriptWallet("Alice", seedA, (l) => console.log(`  ${l}`)), scriptWallet("Bob", seedB, (l) => console.log(`  ${l}`))]);
  console.log(`Alice ${alice.address}\nBob   ${bob.address}`);
  const initialNight = (await alice.nightBalance()) + (await bob.nightBalance());
  const pa = profile("Alice", seedA);
  const pb = profile("Bob", seedB);

  let address = values.table;
  if (!address) {
    console.log("opening a table");
    address = await live.deployTable(alice, pa);
    console.log(`  table ${address}`);
  }
  process.stdout.write("waiting for the indexer to see it");
  for (let i = 0; !(await snapshot(config.indexerUri, address)).state; i++) {
    if (i > 60) throw new Error("the indexer never saw the table");
    await new Promise((r) => setTimeout(r, 2000));
    process.stdout.write(".");
  }
  console.log();

  console.log("Alice takes a seat (join: proven here, balanced by the wallet)");
  const ja = await live.joinTable(alice, pa, address);
  console.log(`  seat ${ja.seat.index}`);
  console.log("Bob takes a seat");
  const jb = await live.joinTable(bob, pb, address);
  console.log(`  seat ${jb.seat.index}`);

  console.log("the deal: keys, shuffles, shares, every street, showdown, then withdrawal");
  const a = new LiveReferee(ja.chain, ja.seat, { betweenDeals: 3_600_000, store: memoryStore() });
  const b = new LiveReferee(jb.chain, jb.seat, { betweenDeals: 3_600_000, store: memoryStore() });
  const streets = new Set<string>();
  const actionErrors: unknown[] = [];
  // Every change of message, for the log: what each referee is doing or failing at.
  for (const [who, ref] of [["Alice", a], ["Bob", b]] as const) {
    let last = "";
    let latest: TableState;
    let acting = false;
    const drive = async () => {
      if (acting || !latest.legal) return;
      acting = true;
      try {
        await ref.act(latest.legal.check ? { type: "check" } : { type: "call" });
      } catch (error) {
        actionErrors.push(error);
      } finally {
        acting = false;
        if (latest.legal && actionErrors.length === 0) queueMicrotask(() => void drive());
      }
    };
    ref.subscribe((s: TableState) => {
      latest = s;
      streets.add(s.street);
      if (s.message !== last) console.log(`  [${who}] ${s.message || "(playing)"}`);
      last = s.message;
      void drive();
    });
  }
  a.start();
  b.start();
  try {
    const finished = (s: TableState) => s.street === "between" && s.seats.some((seat) => seat.isWinner);
    const [done] = await Promise.all([until(a, finished, 900_000), until(b, finished, 900_000)]);
    console.log(`  ${done.message}; stacks ${done.seats.filter((s) => s.name).map((s) => `${s.name} ${s.stack}`).join(", ")}`);
    assert.equal(actionErrors.length, 0, `betting failed: ${actionErrors.map(String).join("; ")}`);
    for (const street of ["preflop", "flop", "turn", "river", "showdown"]) assert(streets.has(street), `did not reach ${street}`);
    assert.equal(done.board.length, 5);
    assert.equal(done.seats.reduce((n, seat) => n + seat.stack, 0), 400);
    const end = await ja.chain.snapshot();
    const l = ledger(ContractState.deserialize(end.state!.serialize()).data);
    assert.equal(l.phase, Phase.done);
    assert.equal(l.scores.size(), 2n);
    assert.equal([...end.state!.balance.values()].reduce((a, b) => a + b, 0n), 800n);
  } finally {
    a.stop();
    b.stop();
  }

  for (const joined of [ja, jb]) {
    for (const circuit of ["stand_up", "leave"] as const) {
      const before = await joined.chain.snapshot();
      const args = circuit === "stand_up" ? [BigInt(joined.seat.index), true] : [BigInt(joined.seat.index)];
      const { tx } = await callOn(joined.chain, before, joined.seat, circuit, args);
      await joined.chain.submit(tx);
      await waitFor(async () => {
        const next = await joined.chain.snapshot();
        const l = ledger(ContractState.deserialize(next.state!.serialize()).data);
        return circuit === "stand_up" ? l.leaving[joined.seat.index]! : !l.seat_owner.member(BigInt(joined.seat.index));
      }, circuit);
    }
  }
  const emptied = await ja.chain.snapshot();
  assert.equal([...emptied.state!.balance.values()].reduce((a, b) => a + b, 0n), 0n);
  await waitFor(async () => (await alice.nightBalance()) + (await bob.nightBalance()) === initialNight, "both stacks and bonds to return to the wallets");
  console.log("Ledger 9 end-to-end passed: deployed, dealt every street, settled, withdrew; Night conserved, fees paid in DUST.");
  await Promise.all([alice.close(), bob.close()]);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
