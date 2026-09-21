import { createConstructorContext } from "@midnight-ntwrk/compact-runtime";
import * as L from "@midnightntwrk/ledger-v9";
import { Seat } from "../referee/contract.ts";
import { type Chain, COIN_PUBLIC_KEY, type Snapshot } from "./chain.ts";
import { bytes, deployable, deployTx } from "./ledger.ts";

// A chain in memory, for tests: a ledger state that applies transactions the way a node would,
// minus the proofs (the circuits are proven in the proof gate; here they are only run), with
// one funded player whose Night covers every buy-in. Time is the wall clock, as on a chain.

const lax = new L.WellFormedStrictness();
lax.enforceBalancing = false; // fees are paid in DUST, which nobody here has
lax.verifyContractProofs = false;
lax.verifyNativeProofs = false;
lax.verifySignatures = false;
lax.enforceLimits = true;

export class LocalChain implements Chain {
  readonly network = "undeployed";
  /** Transactions applied so far. */
  applied = 0;
  private readonly watchers = new Set<(snap: Snapshot) => void>();
  private constructor(
    readonly address: string,
    private state: L.LedgerState,
    private readonly key: L.SigningKey,
  ) {}

  /** The player's payout address: also where their Night sits. */
  get me(): L.UserAddress {
    return L.addressFromKey(L.signatureVerifyingKey(this.key));
  }
  get ledgerState() {
    return this.state;
  }

  /** A funded player and a freshly deployed table taking Night as its asset. */
  static async deploy(verifierKey: (circuit: string) => Promise<Uint8Array>, night = 10_000_000n): Promise<LocalChain> {
    const key = L.sampleSigningKey();
    const vk = L.signatureVerifyingKey(key);
    const me = L.addressFromKey(vk);
    const now = new Date();
    let state = L.LedgerState.blank("undeployed").testingDistributeNight(me, night, now);
    const claim = L.ClaimRewardsTransaction.new("undeployed", night, vk, L.sampleIntentHash(), "Reward");
    state = applyTo(state, L.Transaction.fromRewards(claim.addSignature(L.signData(key, claim.dataToSign))), now);
    const constructed = await new Seat("deployer").contract.initialState(createConstructorContext({}, COIN_PUBLIC_KEY), bytes(L.nativeToken().raw));
    const { address, tx } = deployTx("undeployed", await deployable(constructed.currentContractState, verifierKey), new Date(now.getTime() + 3_600_000));
    state = applyTo(state, tx.eraseProofs(), now);
    return new LocalChain(address, state, key);
  }

  async snapshot(): Promise<Snapshot> {
    return { state: this.state.index(this.address) ?? null, time: Math.floor(Date.now() / 1000), params: this.state.parameters };
  }

  /** Balances from the player's Night, applies, and keeps the new state. Rejected transactions throw. */
  async submit(tx: L.UnprovenTransaction): Promise<void> {
    const now = new Date();
    for (const [segment, intent] of tx.intents ?? []) {
      // What the call is short of in this segment (the contract's receives) comes from the biggest UTXO.
      const short = [...tx.imbalances(segment).entries()].find(([t]) => t.tag === "unshielded" && t.raw === L.nativeToken().raw)?.[1] ?? 0n;
      if (short >= 0n) continue;
      const utxo = [...this.state.utxo.filter(this.me)].sort((a, b) => Number(b.value - a.value))[0];
      if (!utxo || utxo.value < -short) throw new Error("the player is out of Night");
      const offer = intent.fallibleUnshieldedOffer;
      intent.fallibleUnshieldedOffer = L.UnshieldedOffer.new(
        [...(offer?.inputs ?? []), { value: utxo.value, owner: L.signatureVerifyingKey(this.key), type: utxo.type, intentHash: utxo.intentHash, outputNo: utxo.outputNo }],
        [...(offer?.outputs ?? []), { value: utxo.value + short, owner: this.me, type: utxo.type }],
        [],
      );
      tx.intents = new Map([...tx.intents!.entries()].map(([s, i]) => [s, s === segment ? intent : i]));
    }
    this.state = applyTo(this.state, tx.eraseProofs(), now);
    this.applied++;
    // Pushed after the caller's submit resolves, as an indexer would tell every client.
    const snap = await this.snapshot();
    setTimeout(() => this.watchers.forEach((w) => w(snap)), 0);
  }

  watch(onChange: (snap: Snapshot) => void): () => void {
    this.watchers.add(onChange);
    return () => void this.watchers.delete(onChange);
  }
}

function applyTo(state: L.LedgerState, tx: L.Transaction<L.SignatureEnabled, L.Proofish, L.Bindingish>, now: Date): L.LedgerState {
  const seconds = BigInt(Math.floor(now.getTime() / 1000));
  const block: L.BlockContext = { secondsSinceEpoch: seconds, secondsSinceEpochErr: 30, parentBlockHash: "00".repeat(32), lastBlockTime: seconds - 6n };
  const verified = tx.wellFormed(state, lax, now);
  const [next, result] = state.apply(verified, new L.TransactionContext(state, block));
  if (result.type !== "success") throw new Error(`transaction ${result.type}: ${result.error}`);
  return next;
}
