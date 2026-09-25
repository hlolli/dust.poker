// A wallet from a seed on the local network, wearing the DApp connector's shape (src/live/
// wallet.ts) so the site's Live code drives it as it would Lace. The ledger-9 wallet SDK
// balances, signs and submits; the wasm prover in .compact/prover proves. Test only: the seed
// is on the command line and the network is the undeployed one.
import * as Ll from "@midnightntwrk/ledger-v9"; // local/'s copy: the one the wallet SDK holds
import { createKeystore, DustWallet, InMemoryTransactionHistoryStorage, PublicKey, ShieldedWallet, UnshieldedWallet, WalletEntrySchema, WalletFacade, WalletSeeds, WalletTransaction, type DefaultConfiguration, type FinalizedTx } from "@midnightntwrk/wallet-sdk";

export const root = `${import.meta.dir}/..`;
export const NETWORK = "undeployed";
export const config = {
  networkId: NETWORK,
  substrateNodeUri: "ws://127.0.0.1:9944",
  indexerUri: "http://127.0.0.1:8088/api/v4/graphql",
  indexerWsUri: "ws://127.0.0.1:8088/api/v4/graphql/ws",
};
// The site reads its key location off the page; here the keys are files.
Object.assign(globalThis, { location: { search: `?keys=file://${root}/contracts/build/deal` } });

const { keyMaterial } = await import(`${root}/contracts/harness.ts`);
const zkir = await import(`${root}/.compact/prover/zkir-wasm/midnight_zkir_wasm_fs.js`);
const { decodeAddress } = await import(`${root}/src/live/wallet.ts`);
export type Wallet = import("../src/live/wallet.ts").Wallet;

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const HOUR = 3_600_000;

/** The genesis seeds of the dev preset: 00..01 to 00..04, each holding Night. */
export const seed = (n: number) => "00".repeat(31) + n.toString(16).padStart(2, "0");

export async function scriptWallet(name: string, seedHex: string, log: (line: string) => void = console.log): Promise<Wallet> {
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
        log(`${name}: balanced and signed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
        return { tx: out };
      },
      async submitTransaction(tx: string) {
        const sealed = finalized.get(tx);
        if (!sealed) throw new Error("not a transaction this wallet balanced");
        const t0 = performance.now();
        try {
          const id = await facade.submitTransaction(sealed);
          log(`${name}: submitted ${id.slice(0, 16)}... (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
        } catch (e) {
          // The SDK's error wraps the node's answer in Effect's failure; the whole thing, once, for the log.
          log(`${name}: submission failed: ${Bun.inspect(e, { depth: 8 }).replace(/\n\s+at .*$/gm, "").slice(0, 2500)}`);
          throw e;
        }
      },
      getProvingProvider: async () => prover,
    },
  };
}
