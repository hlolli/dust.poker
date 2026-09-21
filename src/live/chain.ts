// The chain as a Live table sees it: the referee's current state and the block it came
// with, and a way to get a transaction in. Behind it, the wallet's indexer and the wallet
// itself (walletChain); in tests, a ledger state in memory (local.ts).
import { type CircuitResults, ContractState as RuntimeContractState, createCircuitContext } from "@midnight-ntwrk/compact-runtime";
import * as L from "@midnightntwrk/ledger-v9";
import type { Seat } from "../referee/contract.ts";
import { type Arg, type Circuit, UNTIMED } from "../referee/rules.ts";
import { snapshot as indexerSnapshot } from "./indexer.ts";
import { bytes, callTx, hex, prove } from "./ledger.ts";
import type { KeyMaterialProvider, Wallet } from "./wallet.ts";

export type Snapshot = {
  /** The referee's state, or null when nothing is deployed at the address. */
  state: L.ContractState | null;
  /** The block's time, seconds since the epoch: the clock a circuit states. */
  time: number;
  params: L.LedgerParameters;
};

export interface Chain {
  readonly network: string;
  readonly address: string;
  snapshot(): Promise<Snapshot>;
  /** Proves (with whatever prover this player has), balances, signs and submits. */
  submit(tx: L.UnprovenTransaction): Promise<void>;
}

// The contract holds no shielded coins, so the Zswap coin public key the runtime wants is moot.
export const COIN_PUBLIC_KEY = "00".repeat(32);
const HOUR = 3_600_000;

/** Runs a circuit for a seat against a snapshot and wraps the run into a transaction. */
export async function callOn(chain: Chain, snap: Snapshot, seat: Seat, circuit: Circuit, args: Arg[]): Promise<{ tx: L.UnprovenTransaction; result: unknown }> {
  if (!snap.state) throw new Error(`no table at ${chain.address.slice(0, 12)}...`);
  const ctx = createCircuitContext(circuit, chain.address, COIN_PUBLIC_KEY, RuntimeContractState.deserialize(snap.state.serialize()), {}, undefined, undefined, undefined, snap.time);
  const all = UNTIMED.has(circuit) ? args : [...args, BigInt(snap.time)];
  const run = await (seat.contract.circuits[circuit] as (c: typeof ctx, ...a: Arg[]) => Promise<CircuitResults>)(ctx, ...all);
  return { tx: callTx(chain.network, run, snap.state, snap.params, new Date(Date.now() + HOUR)), result: run.result };
}

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

async function walletProver(w: Wallet): Promise<L.ProvingProvider> {
  const p = await w.api.getProvingProvider(keyMaterial);
  return {
    check: (preimage, key) => p.check(preimage, key),
    prove: (preimage, key, binding) => p.prove(preimage, key, binding),
    lookupKey: async (key) => ({ proverKey: await keyMaterial.getProverKey(key), verifierKey: await keyMaterial.getVerifierKey(key), ir: await keyMaterial.getZKIR(key) }),
  };
}

/** Proven by the wallet's prover, balanced and signed by the wallet, submitted through it. */
export async function submitThrough(w: Wallet, tx: L.UnprovenTransaction): Promise<void> {
  const proven = await prove(tx, await walletProver(w));
  const { tx: balanced } = await w.api.balanceUnsealedTransaction(hex(proven.serialize()));
  await w.api.submitTransaction(balanced);
}

/** The chain through the player's wallet: its indexer for reading, its prover and its coins for writing. */
export function walletChain(w: Wallet, address: string): Chain {
  return {
    network: w.networkId,
    address,
    async snapshot() {
      const snap = await indexerSnapshot(w.config.indexerUri, address);
      return { state: snap.state ? L.ContractState.deserialize(bytes(snap.state)) : null, time: snap.block.timestamp, params: L.LedgerParameters.deserialize(bytes(snap.block.ledgerParameters)) };
    },
    submit: (tx) => submitThrough(w, tx),
  };
}
