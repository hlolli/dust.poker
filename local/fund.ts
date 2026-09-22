// Funds a wallet on the local network (local/compose.yml) from the genesis wallet, which holds
// the chain's Night. Registers the genesis wallet's Night for DUST first if it has none, since
// fees are paid in DUST. The ledger-9 wallet SDK (beta) does the wallet work; this only drives it.
//
//   bun local/fund.ts <mn_addr_undeployed1...>        50 Night to that address (or --night N)
//   bun local/fund.ts --address <seed hex>            the unshielded address a seed derives to
//   bun local/fund.ts --balance <seed hex>            what a seed's wallet holds
//
// Seeds are 32-byte hex; the genesis one is 00..01. A Lace wallet on the Undeployed network
// shows its mn_addr_undeployed address under Receive; give it that.
import { parseArgs } from "node:util";
import * as L from "@midnightntwrk/ledger-v9";
import {
  createKeystore,
  DustWallet,
  InMemoryTransactionHistoryStorage,
  MidnightBech32m,
  PublicKey,
  ShieldedWallet,
  UnshieldedAddress,
  UnshieldedWallet,
  WalletEntrySchema,
  WalletFacade,
  WalletSeeds,
  type DefaultConfiguration,
} from "@midnightntwrk/wallet-sdk";

const NETWORK = "undeployed";
const GENESIS = "00".repeat(31) + "01";
const configuration: DefaultConfiguration = {
  networkId: NETWORK,
  costParameters: { feeBlocksMargin: 5 },
  relayURL: new URL(process.env.MN_NODE_WS ?? "ws://127.0.0.1:9944"),
  provingServerUrl: new URL(process.env.MN_PROOF_SERVER_URL ?? "http://127.0.0.1:6300"),
  indexerClientConnection: {
    indexerHttpUrl: process.env.MN_INDEXER_URL ?? "http://127.0.0.1:8088/api/v4/graphql",
    indexerWsUrl: process.env.MN_INDEXER_WS ?? "ws://127.0.0.1:8088/api/v4/graphql/ws",
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema),
};

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

/** The unshielded signing key of a master seed: Midnight's HD scheme, account 0, first address. */
const keystoreOf = (seed: Uint8Array) => createKeystore({ kind: "schnorr", secret: WalletSeeds.fromMasterSeed(seed).unshielded }, NETWORK);

async function open(seed: Uint8Array) {
  const seeds = WalletSeeds.fromMasterSeed(seed);
  const keystore = createKeystore({ kind: "schnorr", secret: seeds.unshielded }, NETWORK);
  const wallet = await WalletFacade.init({
    configuration,
    shielded: (c) => ShieldedWallet(c).startWithSeed(seeds.shielded),
    unshielded: (c) => UnshieldedWallet(c).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
    dust: (c) => DustWallet(c).startWithSeed(seeds.dust),
  });
  await wallet.start(seeds);
  return { wallet, keystore, sign: keystore.signDataAsync };
}

const NIGHT = L.nativeToken().raw;
const STARS = 1_000_000n; // one Night
const night = (stars: bigint) => `${stars / STARS} Night`;

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { address: { type: "string" }, balance: { type: "string" }, night: { type: "string", default: "50" }, seed: { type: "string", default: GENESIS } } });
  if (values.address) {
    console.log(keystoreOf(hex(values.address)).getBech32Address().toString());
    return;
  }
  if (values.balance) {
    const { wallet } = await open(hex(values.balance));
    const s = await wallet.waitForSyncedState();
    console.log(`Night ${night(s.unshielded.balances[NIGHT] ?? 0n)}, DUST coins ${s.dust.availableCoins.length}, Night UTXOs ${s.unshielded.availableCoins.length} (${s.unshielded.availableCoins.filter((u) => u.meta.registeredForDustGeneration).length} registered for DUST)`);
    return;
  }
  const to = positionals[0];
  if (!to) throw new Error("give an mn_addr_undeployed address, or --address / --balance <seed>");
  const receiver = MidnightBech32m.parse(to).decode(UnshieldedAddress, NETWORK);
  const amount = BigInt(values.night!) * STARS;

  const { wallet, keystore, sign } = await open(hex(values.seed!));
  let s = await wallet.waitForSyncedState();
  console.log(`genesis wallet: ${night(s.unshielded.balances[NIGHT] ?? 0n)}, DUST coins ${s.dust.availableCoins.length}`);
  if (s.dust.availableCoins.length === 0) {
    // No DUST yet: register the Night for generation, then wait for some to accrue.
    const unregistered = s.unshielded.availableCoins.filter((u) => !u.meta.registeredForDustGeneration);
    if (unregistered.length) {
      console.log(`registering ${unregistered.length} Night UTXO(s) for DUST`);
      const recipe = await wallet.registerNightUtxosForDustGeneration(unregistered, keystore.getPublicKey(), sign);
      await wallet.submitTransaction(await wallet.finalizeRecipe(recipe));
    }
    process.stdout.write("waiting for DUST");
    for (let i = 0; s.dust.availableCoins.length === 0 && i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      s = await wallet.waitForSyncedState();
      process.stdout.write(".");
    }
    console.log(` ${s.dust.availableCoins.length} coin(s)`);
    if (s.dust.availableCoins.length === 0) throw new Error("no DUST accrued; try again in a minute");
  }
  console.log(`sending ${night(amount)} to ${to}`);
  const recipe = await wallet.transferTransaction([{ type: "unshielded", outputs: [{ type: NIGHT, receiverAddress: receiver, amount }] }], { ttl: new Date(Date.now() + 30 * 60_000) });
  const tx = await wallet.finalizeRecipe(await wallet.signRecipe(recipe, sign));
  const id = await wallet.submitTransaction(tx);
  console.log(`submitted ${id}`);
  s = await wallet.waitForSyncedState();
  console.log(`genesis wallet now: ${night(s.unshielded.balances[NIGHT] ?? 0n)}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
