// The referee's transactions on Midnight's ledger (v9): the deploy, and a call assembled from a
// circuit run locally against the contract's current state. No network here: the wallet balances
// and submits (wallet.ts), and ledger.test.ts applies these to a ledger state in memory.
//
// Two wasm modules meet here. The compact runtime (compact-runtime, onchain-runtime-v4) runs the
// circuit and records the transcript; the ledger (ledger-v9) checks and applies transactions.
// Their classes are distinct even where the names match, so state crosses by serialising, and
// plain data (transcripts, effects, block context) crosses as it is.
import type { CircuitResults } from "@midnight-ntwrk/compact-runtime";
import type { ContractState as RuntimeContractState } from "@midnight-ntwrk/compact-runtime";
import * as L from "@midnightntwrk/ledger-v9";

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

/** The verifier key of a circuit by name, as `compact:build --zk` writes them. */
export type VerifierKeys = (circuit: string) => Promise<Uint8Array>;

/** What a deploy puts on chain: the constructor's ledger with a verifier key on every circuit.
 *  The constructor alone declares its circuits with blank keys. */
export async function deployable(constructed: RuntimeContractState, keys: VerifierKeys): Promise<L.ContractState> {
  const state = L.ContractState.deserialize(constructed.serialize());
  for (const name of state.operations()) {
    const op = new L.ContractOperation();
    op.verifierKey = await keys(String(name));
    state.setOperation(name, op);
  }
  return state;
}

export function deployTx(network: string, state: L.ContractState, ttl: Date): { address: L.ContractAddress; tx: L.UnprovenTransaction } {
  const deploy = new L.ContractDeploy(state);
  return { address: deploy.address, tx: L.Transaction.fromParts(network, undefined, undefined, L.Intent.new(ttl).addDeploy(deploy)) };
}

/**
 * A call transaction from a circuit run locally against the contract's current state: the
 * root call of the run, its transcript partitioned by the ledger into guaranteed and fallible
 * parts. The unshielded inputs the circuit expects (a buy-in, a bond) and the fee are the
 * wallet's to add when it balances the transaction.
 */
export function callTx(network: string, run: CircuitResults, contract: L.ContractState, params: L.LedgerParameters, ttl: Date): L.UnprovenTransaction {
  const call = run.context.callProofDataTrace.at(-1)!;
  const op = contract.operation(call.circuitId);
  if (!op) throw new Error(`the contract has no circuit ${call.circuitId}`);
  const before = call.initialQueryContext;
  const context = new L.QueryContext(new L.ChargedState(L.StateValue.decode(before.state.state.encode())), call.contractAddress);
  context.block = before.block;
  context.effects = before.effects;
  const pre = new L.PrePartitionContractCall(
    call.contractAddress,
    call.circuitId,
    op,
    new L.PreTranscript(context, call.publicTranscript),
    call.privateTranscriptOutputs,
    call.input,
    call.output,
    L.communicationCommitmentRandomness(),
    call.circuitId, // the key location: our provers look keys up by circuit name
  );
  const tx = L.Transaction.fromParts(network).addCalls({ tag: "first" }, [pre], params, ttl);
  // What the call pays out to players (a leaver's stack, an abort's refunds) must appear as
  // outputs of the same segment, or the transaction is unbalanced; the wallet adds only inputs.
  const [segment, intent] = [...tx.intents!.entries()][0]!;
  const action = intent.actions[0] as L.ContractCall<L.PreProof>;
  const payouts = (t: L.Transcript<L.AlignedValue> | undefined): L.UtxoOutput[] =>
    [...(t?.effects.claimedUnshieldedSpends ?? [])].filter(([[type, to]]) => to.tag === "user" && type.tag !== "dust").map(([[type, to], value]) => ({ value, owner: to.address, type: (type as L.UnshieldedTokenType).raw }));
  const guaranteed = payouts(action.guaranteedTranscript);
  const fallible = payouts(action.fallibleTranscript);
  if (guaranteed.length) intent.guaranteedUnshieldedOffer = L.UnshieldedOffer.new([], guaranteed, []);
  if (fallible.length) intent.fallibleUnshieldedOffer = L.UnshieldedOffer.new([], fallible, []);
  if (guaranteed.length || fallible.length) tx.intents = new Map([[segment, intent]]);
  return tx;
}

/** Proves every call in the transaction with the given prover (ours in the browser, or the wallet's). */
export const prove = (tx: L.UnprovenTransaction, prover: L.ProvingProvider) => tx.prove(prover, L.CostModel.initialCostModel());
