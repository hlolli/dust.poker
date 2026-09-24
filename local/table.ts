// A Live table on the local network without Lace: two wallets driven from seeds open a table,
// take two seats and play a deal, through the same code the site runs (src/live). Each step is
// a real transaction: proven here with the wasm prover, balanced and signed by the wallet SDK,
// submitted to the node, read back through the indexer. The end-to-end check of the Live table.
//
//   bun local/table.ts                 # seeds 00..02 and 00..03, both genesis wallets
//   bun local/table.ts --table <hex>   # join an existing table instead of opening one
//
// Needs the stack from local/compose.yml and local/indexer.sh, the keys from
// `bun run compact:build --zk`, and the wasm prover in .compact/prover.
import { parseArgs } from "node:util";
import * as Ll from "@midnightntwrk/ledger-v9"; // local/'s copy: the one the wallet SDK holds
import { createKeystore, DustWallet, InMemoryTransactionHistoryStorage, PublicKey, ShieldedWallet, UnshieldedWallet, WalletEntrySchema, WalletFacade, WalletSeeds, WalletTransaction, type DefaultConfiguration, type FinalizedTx } from "@midnightntwrk/wallet-sdk";

const root = `${import.meta.dir}/..`;
const NETWORK = "undeployed";
const config = {
  networkId: NETWORK,
  substrateNodeUri: "ws://127.0.0.1:9944",
  indexerUri: "http://127.0.0.1:8088/api/v4/graphql",
  indexerWsUri: "ws://127.0.0.1:8088/api/v4/graphql/ws",
};
// The site reads its key location and the wallet's address format off the page; here the keys are files.
Object.assign(globalThis, { location: { search: `?keys=file://${root}/contracts/build/deal` } });

const { keyMaterial } = await import(`${root}/contracts/harness.ts`);
const zkir = await import(`${root}/.compact/prover/zkir-wasm/midnight_zkir_wasm_fs.js`);
const { decodeAddress } = await import(`${root}/src/live/wallet.ts`);
type Wallet = import("../src/live/wallet.ts").Wallet;
const live = await import(`${root}/src/live/live.ts`);
const { LiveReferee } = await import(`${root}/src/live/referee.ts`);
const { snapshot } = await import(`${root}/src/live/indexer.ts`);
type TableState = import("../src/referee/types.ts").TableState;
type KeyStore = import("../src/live/referee.ts").KeyStore;
type Profile = import("../src/ui/profiles.ts").Profile;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const HOUR = 3_600_000;

/** A wallet from a seed, wearing the DApp connector's shape so the site's Live code drives it. */
async function scriptWallet(name: string, seedHex: string): Promise<Wallet> {
  const seeds = WalletSeeds.fromMasterSeed(bytes(seedHex));
  const keystore = createKeystore({ kind: "schnorr", secret: seeds.unshielded }, NETWORK);
  const configuration: DefaultConfiguration = {
    networkId: NETWORK,
    costParameters: { feeBlocksMargin: 5 },
    relayURL: new URL(config.substrateNodeUri),
    provingServerUrl: new URL("http://127.0.0.1:6300"),
    indexerClientConnection: { indexerHttpUrl: config.indexerUri, indexerWsUrl: config.indexerWsUri },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema),
  };
  const facade = await WalletFacade.init({
    configuration,
    shielded: (c) => ShieldedWallet(c).startWithSeed(seeds.shielded),
    unshielded: (c) => UnshieldedWallet(c).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
    dust: (c) => DustWallet(c).startWithSeed(seeds.dust),
  });
  await facade.start(seeds);
  await facade.waitForSyncedState();
  const address = keystore.getBech32Address().toString();
  const finalized = new Map<string, FinalizedTx>();
  const prover = zkir.provingProvider(keyMaterial(root));
  return {
    name,
    networkId: NETWORK,
    address,
    payout: decodeAddress(address).bytes,
    config,
    api: {
      getUnshieldedAddress: async () => ({ unshieldedAddress: address }),
      getConfiguration: async () => config,
      // Proven and unbound, as Lace takes it: the wallet adds the coins and the fee, signs, seals.
      async balanceUnsealedTransaction(tx: string) {
        const t0 = performance.now();
        const unbound = Ll.Transaction.deserialize("signature", "proof", "pre-binding", bytes(tx));
        const version = (await facade.waitForSyncedState()).activeProtocolVersion;
        const recipe = await facade.balanceUnboundTransaction(WalletTransaction.adopt("Unbound", unbound, version), { ttl: new Date(Date.now() + HOUR) });
        const sealed = await facade.finalizeRecipe(await facade.signRecipe(recipe, keystore.signDataAsync));
        const out = hex(sealed.serialize());
        finalized.set(out, sealed);
        console.log(`  ${name}: balanced and signed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
        if (process.env.COST) {
          const params = Ll.LedgerParameters.deserialize(bytes((await snapshot(config.indexerUri, "00".repeat(32))).block.ledgerParameters));
          const full = Ll.Transaction.deserialize("signature", "proof", "binding", bytes(out));
          console.log(`  ${name}: ${out.length / 2} bytes, block fullness`, params.normalizeFullness(full.cost(params)));
        }
        return { tx: out };
      },
      async submitTransaction(tx: string) {
        const t0 = performance.now();
        try {
          const id = await facade.submitTransaction(finalized.get(tx)!);
          console.log(`  ${name}: submitted ${id.slice(0, 16)}... (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
        } catch (e) {
          // The SDK's error wraps the node's answer in Effect's failure; the whole thing, once, for the log.
          console.error(`  ${name}: submission failed:`, Bun.inspect(e, { depth: 8 }).replace(/\n\s+at .*$/gm, "").slice(0, 2500));
          throw e;
        }
      },
      getProvingProvider: async () => prover,
    },
  };
}

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

async function main() {
  const { values } = parseArgs({ options: { table: { type: "string" } } });
  const [seedA, seedB] = ["00".repeat(31) + "02", "00".repeat(31) + "03"];
  const [alice, bob] = await Promise.all([scriptWallet("Alice", seedA), scriptWallet("Bob", seedB)]);
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
