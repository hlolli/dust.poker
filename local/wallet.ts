// A wallet from a seed on the local network, wearing the DApp connector's shape (src/live/
// wallet.ts) so the site's Live code drives it as it would Lace. The ledger-9 wallet SDK
// balances, signs and submits; the local proof server proves. Test only: the seed
// is on the command line and the network is the undeployed one.
import * as Ll from "@midnightntwrk/ledger-v9"; // local/'s copy: the one the wallet SDK holds
import { createKeystore, DustWallet, InMemoryTransactionHistoryStorage, PublicKey, ShieldedWallet, UnshieldedWallet, WalletEntrySchema, WalletFacade, WalletSeeds, WalletTransaction, type DefaultConfiguration, type FinalizedTx } from "@midnightntwrk/wallet-sdk";
import { proofServer } from "./prover.ts";

export const root = `${import.meta.dir}/..`;
export const NETWORK = "undeployed";
export const config = {
  networkId: NETWORK,
  substrateNodeUri: "ws://127.0.0.1:9944",
  indexerUri: "http://127.0.0.1:8088/api/v4/graphql",
  indexerWsUri: "ws://127.0.0.1:8088/api/v4/graphql/ws",
};
// The site reads its key location off the page; here the keys are files.
Object.assign(globalThis, { location: { hostname: "localhost", search: `?keys=file://${root}/contracts/build/deal` } });

const { decodeAddress } = await import(`${root}/src/live/wallet.ts`);
export type Wallet = import("../src/live/wallet.ts").Wallet;
export type ScriptWallet = Wallet & { close(): Promise<void>; nightBalance(): Promise<bigint> };

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const HOUR = 3_600_000;

/** The genesis seeds of the dev preset: 00..01 to 00..04, each holding Night. */
export const seed = (n: number) => "00".repeat(31) + n.toString(16).padStart(2, "0");

export async function scriptWallet(name: string, seedHex: string, log: (line: string) => void = console.log): Promise<ScriptWallet> {
  const seeds = WalletSeeds.fromMasterSeed(bytes(seedHex));
  const keystore = createKeystore({ kind: "schnorr", secret: seeds.unshielded }, NETWORK);
  const configuration = {
    networkId: NETWORK,
    costParameters: { feeBlocksMargin: 5 },
    relayURL: new URL(config.substrateNodeUri),
    provingServerUrl: new URL("http://127.0.0.1:6300"),
    indexerClientConnection: { indexerHttpUrl: config.indexerUri, indexerWsUrl: config.indexerWsUri },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema),
  } satisfies DefaultConfiguration;
  const facade = await WalletFacade.init({
    configuration,
    shielded: (c) => ShieldedWallet(c).startWithSeed(seeds.shielded),
    unshielded: (c) => UnshieldedWallet(c).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
    dust: (c) => DustWallet(c).startWithSeed(seeds.dust),
  });
  await facade.start(seeds);
  let state = await facade.waitForSyncedState();
  if (state.activeProtocolVersion < 2_000_000) throw new Error("the local network is not running Ledger 9");
  if (state.dust.availableCoins.length === 0) {
    const unregistered = state.unshielded.availableCoins.filter((coin) => !coin.meta.registeredForDustGeneration);
    if (unregistered.length) {
      log(`${name}: registering Night for DUST generation`);
      const { fee } = await facade.estimateRegistration(unregistered);
      await facade.waitForGeneratedDust(unregistered, fee, { timeoutMs: 180_000 });
      const recipe = await facade.registerNightUtxosForDustGeneration(unregistered, keystore.getPublicKey(), keystore.signDataAsync);
      await facade.submitTransaction(await facade.finalizeRecipe(recipe));
    }
    const deadline = Date.now() + 180_000;
    while (state.dust.availableCoins.length === 0 && Date.now() < deadline) {
      await Bun.sleep(2000);
      state = await facade.waitForSyncedState();
    }
    if (state.dust.availableCoins.length === 0) throw new Error(`${name}: no DUST became available`);
  }
  const address = keystore.getBech32Address().toString();
  const finalized = new Map<string, FinalizedTx>();
  return {
    name,
    networkId: NETWORK,
    address,
    payout: decodeAddress(address).bytes,
    config,
    close: () => facade.stop(),
    nightBalance: async () => (await facade.waitForSyncedState()).unshielded.balances[Ll.nativeToken().raw] ?? 0n,
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
      getProvingProvider: async (keys) => proofServer(configuration.provingServerUrl.toString(), {
        async lookupKey(circuit) {
          const [ir, proverKey, verifierKey] = await Promise.all([keys.getZKIR(circuit), keys.getProverKey(circuit), keys.getVerifierKey(circuit)]);
          return { ir, proverKey, verifierKey };
        },
      }),
    },
  };
}
