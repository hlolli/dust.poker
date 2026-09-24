import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { ContractState as RuntimeContractState, createCircuitContext, createConstructorContext } from "@midnight-ntwrk/compact-runtime";
import * as L from "@midnightntwrk/ledger-v9";
import { ledger } from "../../contracts/build/deal/contract/index.js";
import { keyMaterial, player } from "../../contracts/harness.ts";
import { CIRCUITS } from "../referee/rules.ts";
import { bytes, callTx, deployInParts, isOurs, hex, prove } from "./ledger.ts";

// The first transactions, applied to a ledger state in memory as a node would: the referee is
// deployed, then a player joins with a real unshielded input, the join proven with the wasm
// prover and verified by the ledger. What the wallet does for a Live table (adding the input
// and the fee, signing) is done here by hand with a test key.
//
// Needs the wasm prover and the keys (prover:build, compact:build --zk), like the proof gate;
// without them (the plain CI workflow) it is skipped, and prove.yml runs it.

const root = `${import.meta.dir}/../..`;
const proverBuilt = existsSync(`${root}/.compact/prover/zkir-wasm/midnight_zkir_wasm_fs.js`) && existsSync(`${root}/contracts/build/deal/keys/join.prover`);
const NETWORK = "undeployed";
const SECONDS = 1_700_000_000;
const now = new Date(SECONDS * 1000);
const ttl = new Date((SECONDS + 3600) * 1000);
const coinPublicKey = "11".repeat(32);
const zkir = proverBuilt ? await import(`${root}/.compact/prover/zkir-wasm/midnight_zkir_wasm_fs.js`) : null;
const prover: L.ProvingProvider = zkir?.provingProvider(keyMaterial(root));
const keys = keyMaterial(root);
const verifierKey = async (circuit: string) => (await keys.lookupKey(circuit)).verifierKey;

const block: L.BlockContext = { secondsSinceEpoch: BigInt(SECONDS), secondsSinceEpochErr: 30, parentBlockHash: "00".repeat(32), lastBlockTime: BigInt(SECONDS - 6) };
const strictness = new L.WellFormedStrictness();
strictness.enforceBalancing = false; // fees are paid in DUST, which the test player does not have
strictness.verifyContractProofs = true;
strictness.verifyNativeProofs = true;
strictness.verifySignatures = true;
strictness.enforceLimits = true;

/** Verifies and applies a sealed transaction, as a node does; returns the new state. */
function apply(state: L.LedgerState, tx: L.Transaction<L.SignatureEnabled, L.Proofish, L.Binding>): L.LedgerState {
  const verified = tx.wellFormed(state, strictness, now);
  const [next, result] = state.apply(verified, new L.TransactionContext(state, block));
  if (result.type !== "success") throw new Error(`transaction ${result.type}: ${result.error}`);
  return next;
}

describe("the referee on the ledger", () => {
  test.skipIf(!proverBuilt)("deploy, then join with a real unshielded input", async () => {
    // A player with Night to bring to the table: rewarded, then claimed into a UTXO.
    const signingKey = L.sampleSigningKey();
    const verifyingKey = L.signatureVerifyingKey(signingKey);
    const me = L.addressFromKey(verifyingKey);
    const NIGHT = 1_000_000n; // in STARs; a claim under about 14,000 STARs is refused as below the payout threshold
    let state = L.LedgerState.blank(NETWORK).testingDistributeNight(me, NIGHT, now);
    const claim = L.ClaimRewardsTransaction.new(NETWORK, NIGHT, verifyingKey, hex(crypto.getRandomValues(new Uint8Array(32))), "Reward");
    state = apply(state, L.Transaction.fromRewards(claim.addSignature(L.signData(signingKey, claim.dataToSign)))); // nothing to prove in a claim
    const [funds] = state.utxo.filter(me);
    expect(funds?.value).toBe(NIGHT);

    // The table takes Night as its asset (the contract takes the token type as Bytes<32>).
    const asset = bytes(L.nativeToken().raw);
    const p = player();
    const constructed = await p.contract.initialState(createConstructorContext({}, coinPublicKey), asset);
    // The deploy in parts: nineteen keys are more than one transaction may write, so the deploy
    // carries some, maintenance updates the rest, and the last update locks the circuits.
    const circuits: string[] = CIRCUITS;
    const plan = await deployInParts(NETWORK, constructed.currentContractState, verifierKey, state.parameters, ttl);
    const { address } = plan;
    expect(plan.updates.length).toBeGreaterThan(0);
    const fullness = (tx: L.UnprovenTransaction) => state.parameters.normalizeFullness(tx.cost(state.parameters)).bytesWritten;
    for (const tx of [plan.deploy, ...plan.updates]) expect(fullness(tx)).toBeLessThanOrEqual(0.6);
    state = apply(state, (await prove(plan.deploy, prover)).bind());
    expect(await isOurs(state.index(address)!, verifierKey, circuits)).toBe(false); // keys missing, and still changeable
    for (const update of plan.updates) state = apply(state, (await prove(update, prover)).bind());
    const deployed = state.index(address)!;
    expect(deployed.operations().map(String).sort()).toEqual([...circuits].sort());
    expect(deployed.operation("join")!.verifierKey.length).toBeGreaterThan(0);
    expect(deployed.maintenanceAuthority.committee).toHaveLength(0);
    expect(await isOurs(deployed, verifierKey, circuits)).toBe(true);
    expect(await isOurs(deployed, async () => new Uint8Array(32), circuits)).toBe(false);

    // Join: run the circuit against the deployed state, then wrap the run into a transaction.
    const runtimeState = RuntimeContractState.deserialize(deployed.serialize());
    const ctx = createCircuitContext("join", address, coinPublicKey, runtimeState, {}, undefined, undefined, undefined, SECONDS);
    const run = await p.contract.circuits.join(ctx, bytes(me), 200n);
    expect(run.result).toBe(0n); // seat 0
    let tx = callTx(NETWORK, run, deployed, state.parameters, ttl);

    // Unbalanced by the buy-in and the bond the contract receives, in the call's segment (1, the
    // intent's fallible part: the ledger put the receive there, so a failed call still pays its fee)...
    const unshielded = (segment: number) => [...tx.imbalances(segment).entries()].find(([t]) => t.tag === "unshielded")?.[1] ?? 0n;
    expect(unshielded(1)).toBe(-400n);
    // ...which the player's UTXO covers, with change back. (The wallet's job on a Live table.)
    const intent = tx.intents!.get(1)!;
    intent.fallibleUnshieldedOffer = L.UnshieldedOffer.new(
      [{ value: funds!.value, owner: verifyingKey, type: funds!.type, intentHash: funds!.intentHash, outputNo: funds!.outputNo }],
      [{ value: funds!.value - 400n, owner: me, type: funds!.type }],
      [],
    );
    tx.intents = new Map([[1, intent]]);
    expect(unshielded(1)).toBe(0n);
    expect(unshielded(0)).toBe(0n);

    // Prove, sign the input, seal.
    const proven = await prove(tx, prover);
    const signed = proven.intents!.get(1)!;
    const signature = L.signData(signingKey, signed.signatureData(1));
    signed.fallibleUnshieldedOffer = signed.fallibleUnshieldedOffer!.addSignatures([new L.SignatureEnabled(signature)]);
    proven.intents = new Map([[1, signed]]);
    state = apply(state, proven.bind());

    // The seat is taken, the escrow holds the buy-in and the bond, the player has the change.
    const after = ledger(RuntimeContractState.deserialize(state.index(address)!.serialize()).data);
    expect(after.seat_owner.member(0n)).toBe(true);
    expect(after.stack[0]).toBe(200n);
    expect([...state.index(address)!.balance.values()]).toEqual([400n]);
    expect([...state.utxo.filter(me)].map((u) => u.value)).toEqual([NIGHT - 400n]);
    expect(hex(bytes(me))).toBe(me);
  }, 120_000);
});
