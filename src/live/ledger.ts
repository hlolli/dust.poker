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

/** A deploy split to fit the chain: the deploy itself, then maintenance updates to apply in order. */
export type Deployment = { address: L.ContractAddress; deploy: L.UnprovenTransaction; updates: L.UnprovenTransaction[] };

/**
 * The deploy in parts. Nineteen verifier keys make a contract state that fills most of a block's
 * writes, more than one transaction may take. So the deploy carries the circuits that fit within
 * `budget` of the block's write limit, and maintenance updates insert the rest, batched to the same
 * budget. The last update also replaces the maintenance authority with an empty one: from then on
 * nobody, the deployer included, can change the circuits. The signing key that authorised the
 * updates lives only in this call.
 */
export async function deployInParts(network: string, constructed: RuntimeContractState, keys: VerifierKeys, params: L.LedgerParameters, ttl: Date, budget = 0.6): Promise<Deployment> {
  const declared = L.ContractState.deserialize(constructed.serialize());
  const names = declared.operations().map(String);
  const vk = new Map(await Promise.all(names.map(async (n) => [n, await keys(n)] as const)));
  const authority = L.sampleSigningKey();
  const fits = (tx: L.UnprovenTransaction) => params.normalizeFullness(tx.cost(params)).bytesWritten <= budget;

  // The deploy: the constructor's ledger, the authority, and keys while they fit.
  const state = new L.ContractState();
  state.data = declared.data;
  state.maintenanceAuthority = new L.ContractMaintenanceAuthority([L.signatureVerifyingKey(authority)], 1, 0n);
  const later: string[] = [];
  for (const name of names) {
    const op = new L.ContractOperation();
    op.verifierKey = vk.get(name)!;
    const trial = L.ContractState.deserialize(state.serialize());
    trial.setOperation(name, op);
    if (later.length === 0 && fits(deployTx(network, trial, ttl).tx)) state.setOperation(name, op);
    else later.push(name);
  }
  const deployed = deployTx(network, state, ttl);

  // The updates: inserts in batches that fit, the last batch also locking the contract.
  const insert = (name: string) => new L.VerifierKeyInsert(name, new L.ContractOperationVersionedVerifierKey("v4", vk.get(name)!));
  const updateTx = (updates: L.SingleUpdate[], counter: bigint) => {
    const update = new L.MaintenanceUpdate(deployed.address, updates, counter);
    return L.Transaction.fromParts(network, undefined, undefined, L.Intent.new(ttl).addMaintenanceUpdate(update.addSignature(0n, L.signData(authority, update.dataToSign))));
  };
  const batches: string[][] = [[]];
  for (const name of later) {
    const batch = batches.at(-1)!;
    if (batch.length && !fits(updateTx([...batch, name].map(insert), 1n))) batches.push([name]);
    else batch.push(name);
  }
  // An update names the authority counter it is valid against (0 at first); applying it advances the counter by one.
  const updates = batches.map((batch, i) => {
    const counter = BigInt(i);
    const lock = i === batches.length - 1 ? [new L.ReplaceAuthority(new L.ContractMaintenanceAuthority([], 1, counter + 1n))] : [];
    return updateTx([...batch.map(insert), ...lock], counter);
  });
  return { address: deployed.address, deploy: deployed.tx, updates };
}

/** Whether a deployed table is ours: every circuit's verifier key is the one we built, and nobody can change them. */
export async function isOurs(state: L.ContractState, keys: VerifierKeys, circuits: string[]): Promise<boolean> {
  if (state.maintenanceAuthority.committee.length !== 0) return false;
  for (const name of circuits) {
    const op = state.operation(name);
    if (!op || Buffer.from(op.verifierKey).compare(Buffer.from(await keys(name))) !== 0) return false;
  }
  return true;
}

/**
 * A call transaction from a circuit run locally against the contract's current state: the
 * root call of the run, its whole transcript in the fallible section. The unshielded inputs
 * the circuit expects (a buy-in, a bond) and the fee are the wallet's to add when it balances
 * the transaction.
 *
 * Why fallible only: the ledger refuses a transaction whose guaranteed section costs more to
 * run than its size pays for ("outside time to dismiss", 2 us a byte, 15 ms at least), so
 * that a transaction cannot make the chain work for free before failing. Its own partitioner
 * (`Transaction.addCalls`) judged the deal's circuits cheap enough to keep whole in the
 * guaranteed section, by a heuristic that undershoots its fee check by a few milliseconds, and
 * the node then rejected them (code 231). Nothing here needs the guaranteed section: the
 * calls hold no shielded coins, and a step that fails against a stale state paying its fee
 * is what a wallet expects. So the section is left empty.
 */
export function callTx(network: string, run: CircuitResults, contract: L.ContractState, params: L.LedgerParameters, ttl: Date): L.UnprovenTransaction {
  const call = run.context.callProofDataTrace.at(-1)!;
  const op = contract.operation(call.circuitId);
  if (!op) throw new Error(`the contract has no circuit ${call.circuitId}`);
  const before = call.initialQueryContext;
  const context = new L.QueryContext(new L.ChargedState(L.StateValue.decode(before.state.state.encode())), call.contractAddress);
  context.block = before.block;
  context.effects = before.effects;
  // The ledger runs the program once to price it and gather its effects. It cuts only at
  // checkpoints, which these circuits do not emit, so the transcript comes back in one piece.
  const [head, tail] = L.partitionTranscripts([new L.PreTranscript(context, call.publicTranscript)], params)[0]!;
  if (head && tail) throw new Error(`${call.circuitId} has a checkpoint; its transcript was expected whole`);
  const whole = head ?? tail;
  const proto = new L.ContractCallPrototype(
    call.contractAddress,
    call.circuitId,
    op,
    undefined,
    whole,
    call.privateTranscriptOutputs,
    call.input,
    call.output,
    L.communicationCommitmentRandomness(),
    call.circuitId, // the key location: our provers look keys up by circuit name
  );
  const tx = L.Transaction.fromParts(network, undefined, undefined, L.Intent.new(ttl).addCall(proto));
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
