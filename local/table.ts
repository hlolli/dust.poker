// A Live table on the local network without Lace: two wallets driven from seeds open a table,
// take two seats and play a deal, through the same code the site runs (src/live). Each step is
// a real transaction: proven here with the wasm prover, balanced and signed by the wallet SDK,
// submitted to the node, read back through the indexer. The end-to-end check of the Live table.
//
//   bun local/table.ts                        # seeds 00..02 and 00..03, both genesis wallets
//   bun local/table.ts --table <hex>          # join an existing table instead of opening one
//   bun local/table.ts --table <hex> --sit 3  # one wallet (seed 3) sits down and plays along,
//                                             # checking or folding, until stopped: an opponent
//                                             # for a player in the browser (local/bridge.ts)
//
// Needs the stack from local/compose.yml and local/indexer.sh, the keys from
// `bun run compact:build --zk`, and the wasm prover in .compact/prover.
import { parseArgs } from "node:util";
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
    const timer = setTimeout(() => (off(), reject(new Error(`timed out: "${last?.message}", street ${last?.street}`))), ms);
    const off = ref.subscribe((s: TableState) => {
      last = s;
      if (ok(s)) (clearTimeout(timer), off(), resolve(s));
    });
  });

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
  if (values.sit) return sit(values.table!, Number(values.sit));
  const [seedA, seedB] = [seed(2), seed(3)];
  const [alice, bob] = await Promise.all([scriptWallet("Alice", seedA, (l) => console.log(`  ${l}`)), scriptWallet("Bob", seedB, (l) => console.log(`  ${l}`))]);
  console.log(`Alice ${alice.address}\nBob   ${bob.address}`);
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

  console.log("the deal: keys, shuffles, shares, then whoever is to act folds");
  const a = new LiveReferee(ja.chain, ja.seat, { betweenDeals: 1000, store: memoryStore() });
  const b = new LiveReferee(jb.chain, jb.seat, { betweenDeals: 1000, store: memoryStore() });
  // Every change of message, for the log: what each referee is doing or failing at.
  for (const [who, ref] of [["Alice", a], ["Bob", b]] as const) {
    let last = "";
    ref.subscribe((s: TableState) => {
      if (s.message !== last) console.log(`  [${who}] ${s.message || "(playing)"}`);
      last = s.message;
    });
  }
  a.start();
  b.start();
  try {
    const [sa, sb] = await Promise.all([until(a, (s) => s.street === "preflop" && s.toAct !== null), until(b, (s) => s.street === "preflop" && s.toAct !== null)]);
    console.log(`  Alice holds ${JSON.stringify(sa.seats[ja.seat.index]!.hole)}, Bob holds ${JSON.stringify(sb.seats[jb.seat.index]!.hole)}, seat ${sa.toAct} to act`);
    const actor = sa.toAct === ja.seat.index ? a : b;
    await actor.act({ type: "fold" });
    const done = await until(a, (s) => s.street === "between" && s.message.includes("win"));
    console.log(`  ${done.message}; stacks ${done.seats.filter((s) => s.name).map((s) => `${s.name} ${s.stack}`).join(", ")}`);
  } finally {
    a.stop();
    b.stop();
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
