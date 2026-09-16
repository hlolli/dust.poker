// A Live table's first transactions, through the player's wallet: deploying a table, and joining
// one. The circuit runs here against the state the indexer reports, the wallet's prover proves it
// (ADR 0005: the player's own software), and the wallet adds the buy-in, the bond and the fee,
// signs, and submits. Import only after the runtime's and the ledger's wasm are ready.
import { ContractState as RuntimeContractState, createCircuitContext, createConstructorContext } from "@midnight-ntwrk/compact-runtime";
import * as L from "@midnightntwrk/ledger-v9";
import { Seat } from "../referee/contract.ts";
import { snapshot } from "./indexer.ts";
import { bytes, callTx, deployable, deployTx, hex, prove } from "./ledger.ts";
import type { Profile } from "../ui/profiles.ts";
import type { KeyMaterialProvider, Wallet } from "./wallet.ts";

export { L as ledger };

// The contract holds no shielded coins, so the Zswap coin public key the runtime wants is moot.
const COIN_PUBLIC_KEY = "00".repeat(32);
const HOUR = 3_600_000;
/** The table's asset: Night, until a test token is chosen (dealing.md, Stakes). */
export const ASSET = () => bytes(L.nativeToken().raw);

// Proving artifacts, fetched from next to the site (build-site.ts copies contracts/build/deal
// there) or from wherever `?keys=` points; the wallet's prover asks for them by circuit name.
const keysBase = () => new URLSearchParams(location.search).get("keys") ?? "/deal";
const fetchBytes = async (path: string) => {
  const res = await fetch(`${keysBase()}/${path}`);
  if (!res.ok) throw new Error(`proving keys: ${path} ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};
export const keyMaterial: KeyMaterialProvider = {
  getZKIR: (c) => fetchBytes(`zkir/${c}.bzkir`),
  getProverKey: (c) => fetchBytes(`keys/${c}.prover`),
  getVerifierKey: (c) => fetchBytes(`keys/${c}.verifier`),
};

async function prover(w: Wallet): Promise<L.ProvingProvider> {
  const p = await w.api.getProvingProvider(keyMaterial);
  return {
    check: (preimage, key) => p.check(preimage, key),
    prove: (preimage, key, binding) => p.prove(preimage, key, binding),
    lookupKey: async (key) => ({ proverKey: await keyMaterial.getProverKey(key), verifierKey: await keyMaterial.getVerifierKey(key), ir: await keyMaterial.getZKIR(key) }),
  };
}

/** Proven here, balanced and signed by the wallet, submitted through it. */
async function submit(w: Wallet, tx: L.UnprovenTransaction): Promise<void> {
  const proven = await prove(tx, await prover(w));
  const { tx: balanced } = await w.api.balanceUnsealedTransaction(hex(proven.serialize()));
  await w.api.submitTransaction(balanced);
}

/** The player at a Live table: the profile's name and its secret, which is the identity the seat owner's point derives from. */
export const you = (profile: Profile) => new Seat(profile.name, BigInt(profile.secret));

/** Deploys a table; returns its address. Nothing to prove in a deploy, but the wallet balances the fee. */
export async function deployTable(w: Wallet, profile: Profile): Promise<string> {
  const constructed = await you(profile).contract.initialState(createConstructorContext({}, COIN_PUBLIC_KEY), ASSET());
  const { address, tx } = deployTx(w.networkId, await deployable(constructed.currentContractState, keyMaterial.getVerifierKey), new Date(Date.now() + HOUR));
  await submit(w, tx);
  return address;
}

/** Joins the table at `address` with `buy` chips; the wallet adds buy plus bond of the table's asset. Returns the seat. */
export async function joinTable(w: Wallet, profile: Profile, address: string, buy = 200n): Promise<number> {
  const snap = await snapshot(w.config.indexerUri, address);
  if (!snap.state) throw new Error(`no table at ${address.slice(0, 12)}...`);
  const contract = L.ContractState.deserialize(bytes(snap.state));
  const ctx = createCircuitContext("join", address, COIN_PUBLIC_KEY, RuntimeContractState.deserialize(contract.serialize()), {}, undefined, undefined, undefined, snap.block.timestamp);
  const run = await you(profile).contract.circuits.join(ctx, w.payout, buy);
  const params = L.LedgerParameters.deserialize(bytes(snap.block.ledgerParameters));
  await submit(w, callTx(w.networkId, run, contract, params, new Date(Date.now() + HOUR)));
  return Number(run.result);
}
