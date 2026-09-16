import { createCircuitContext, createConstructorContext, dummyContractAddress, proofDataIntoSerializedPreimage } from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger } from "./build/deal/contract/index.js";
import { bestFive, forfeitSplit, PRACTICE_ASSET, prepForfeitSplit, shownCards, splits } from "./client.ts";

// A table of players running the compiled contract locally, as the tests, the benchmark and
// the proof gate all need: players with their secrets and witnesses, a clock, and helpers
// that play out the mechanical parts of a deal. No chain, no proofs; every call's proof
// preimage is kept so a prover can be run over it afterwards.

const ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const coinPublicKey = "11".repeat(32);
const address = dummyContractAddress();
type PS = Record<string, never>;
export type State = import("@midnight-ntwrk/compact-runtime").ChargedState;
export type Circuit =
  | "join" | "buy_in" | "stand_up" | "leave" | "start_deal" | "post_key" | "shuffle" | "post_next_key" | "shuffle_next" | "expire_next"
  | "shares" | "release" | "act" | "act_out" | "show" | "show_hand" | "settle" | "expire" | "settle_abort";
/** Every circuit a proof gate must cover: all exported ones but the pure card_point. */
export const CIRCUITS: Circuit[] = [
  "join", "buy_in", "stand_up", "leave", "start_deal", "post_key", "shuffle", "post_next_key", "shuffle_next", "expire_next",
  "shares", "release", "act", "act_out", "show", "show_hand", "settle", "expire", "settle_abort",
];
export type Arg = bigint | bigint[] | Uint8Array | boolean;
const UNTIMED = new Set<Circuit>(["join", "buy_in", "stand_up", "leave", "expire", "settle", "settle_abort"]);
export const Phase = { idle: 0, keys: 1, shuffle: 2, holes: 3, playing: 4, release: 5, tabling: 6, showdown: 7, done: 8, aborted: 9 };
export const Prep = { none: 0, keys: 1, shuffle: 2, ready: 3 };
export const [FOLD, CHECK, CALL, RAISE] = [0n, 0n, 1n, 2n];
export const T0 = 1_700_000_000; // block time, seconds
/** The payout address of a seat in these runs. */
export const addr = (seat: number) => new Uint8Array(32).fill(seat + 1);
export const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
/** Ten positions for the `shares` circuit: fewer are padded by repeating the last one. */
export const ten = (positions: number[]): bigint[] => Array.from({ length: 10 }, (_, i) => BigInt(positions[Math.min(i, positions.length - 1)]!));
export const seatsOf = (l: ReturnType<typeof ledger>) => [0, 1, 2, 3, 4, 5].filter((i) => l.in_deal[i]);

/** Prover keys, verifier keys and IR from `compact:build --zk`, and the KZG params, for a local prover. */
export function keyMaterial(root: string, contract = "deal") {
  const read = (p: string) => Bun.file(p).bytes();
  return {
    async lookupKey(keyLocation: string) {
      const { jsonIrToBinary } = await import(`${root}/.compact/prover/zkir-wasm/midnight_zkir_wasm_fs.js`);
      return {
        proverKey: await read(`${root}/contracts/build/${contract}/keys/${keyLocation}.prover`),
        verifierKey: await read(`${root}/contracts/build/${contract}/keys/${keyLocation}.verifier`),
        ir: jsonIrToBinary(await Bun.file(`${root}/contracts/build/${contract}/zkir/${keyLocation}.zkir`).text()) as Uint8Array,
      };
    },
    async getParams(k: number) {
      const file = `${root}/.compact/prover/params/bls_midnight_2p${k}`;
      if (!(await Bun.file(file).exists())) {
        const res = await fetch(`https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com/bls_midnight_2p${k}`);
        if (!res.ok) throw new Error(`params k=${k}: ${res.status}`);
        await Bun.write(file, await res.arrayBuffer());
      }
      return read(file);
    },
  };
}

export function randomScalar(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return (n % (ORDER - 1n)) + 1n;
}

export function randomPermutation(): bigint[] {
  const p = Array.from({ length: 52 }, (_, i) => BigInt(i));
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  return p;
}

export function player(permutation: bigint[] = randomPermutation()) {
  const secret = randomScalar();
  const blinding = Array.from({ length: 52 }, randomScalar);
  // Two deck keys: this deal's and the one the next deck is being prepared with. They
  // rotate when a deal starts (see Table.call).
  const p = { x: randomScalar(), nextX: randomScalar(), seat: -1, contract: null as unknown as Contract<PS> };
  p.contract = new Contract<PS>({
    player_secret: (ctx) => [ctx.privateState, secret],
    deck_key: (ctx) => [ctx.privateState, p.x],
    next_deck_key: (ctx) => [ctx.privateState, p.nextX],
    // The circuit takes the deck already in secret order; the permutation itself stays here.
    permuted: (ctx) => [ctx.privateState, permutation.map((k) => ctx.ledger.deck[Number(k)]!)],
    next_permuted: (ctx) => [ctx.privateState, permutation.map((k) => ctx.ledger.next_deck[Number(k)]!)],
    blinding: (ctx) => [ctx.privateState, blinding],
    // Showdown and settlement witnesses, computed from the ledger as a client would.
    best_five: (ctx) => [ctx.privateState, bestFive(ctx.ledger, p.seat, p.x)],
    split_share: (ctx) => [ctx.privateState, splits(ctx.ledger).share],
    split_odd: (ctx) => [ctx.privateState, splits(ctx.ledger).odd],
    forfeit_share: (ctx) => [ctx.privateState, forfeitSplit(ctx.ledger).share],
    forfeit_odd: (ctx) => [ctx.privateState, forfeitSplit(ctx.ledger).odd],
    prep_forfeit_share: (ctx) => [ctx.privateState, prepForfeitSplit(ctx.ledger).share],
    prep_forfeit_odd: (ctx) => [ctx.privateState, prepForfeitSplit(ctx.ledger).odd],
  });
  return p;
}
export type Player = ReturnType<typeof player>;

type Effects = { unshieldedInputs: Map<unknown, bigint>; unshieldedOutputs: Map<unknown, bigint>; claimedUnshieldedSpends: Map<[unknown, { address?: string }], bigint> };

/** A table: players in seats 0..n-1 and a clock; every call states the clock as `now`. */
export class Table {
  now = T0;
  state!: State;
  /** The token effects of the last call: what the transaction must bring in and pay out. */
  effects!: Effects;
  /** The first proof preimage seen for each circuit, for a prover to run over. */
  readonly preimages = new Map<Circuit, Uint8Array>();
  constructor(readonly players: Player[]) {}

  static async seated<T extends Table>(this: new (players: Player[]) => T, n: number, players: Player[] = Array.from({ length: n }, () => player())): Promise<T> {
    const t = new this(players);
    t.state = (await players[0]!.contract.initialState(createConstructorContext<PS>({}, coinPublicKey), PRACTICE_ASSET)).currentContractState.data;
    // The referee seats joiners at the first empty seat, so player i lands on seat i.
    for (let i = 0; i < players.length; i++) {
      players[i]!.seat = i;
      const seat = await t.call(i, "join", addr(i), 200n);
      if (seat !== BigInt(i)) throw new Error(`player ${i} was seated at ${seat}`);
    }
    return t;
  }

  /** Circuits that take the clock get it appended. */
  async call(seat: number, circuit: Circuit, ...args: Arg[]): Promise<unknown> {
    const p = this.players[seat]!;
    const ctx = createCircuitContext(circuit, address, coinPublicKey, this.state, {} as PS, undefined, undefined, undefined, this.now);
    const all = UNTIMED.has(circuit) ? args : [...args, BigInt(this.now)];
    const r = await (p.contract.circuits[circuit] as (c: typeof ctx, ...a: Arg[]) => Promise<{ context: typeof ctx; result: unknown }>)(ctx, ...all);
    this.state = r.context.callContext.currentQueryContext.state;
    this.effects = r.context.callContext.currentQueryContext.effects as Effects;
    if (!this.preimages.has(circuit)) {
      // The root circuit's proof data is the last entry of the call trace (depth-first order).
      const pd = r.context.callProofDataTrace.at(-1)!;
      this.preimages.set(circuit, proofDataIntoSerializedPreimage(pd.input, pd.output, pd.publicTranscript, pd.privateTranscriptOutputs, circuit));
    }
    if (circuit === "start_deal") this.rotateKeys();
    return r.result;
  }

  /** A deal started: the key each player prepared the next deck with becomes this deal's key
   *  (or a fresh one, when the deal starts from the keys), and a fresh one is drawn for the
   *  next preparation. What every client does after start_deal. */
  rotateKeys() {
    const prepared = this.ledger.phase === Phase.holes;
    for (const p of this.players) {
      p.x = prepared ? p.nextX : randomScalar();
      p.nextX = randomScalar();
    }
  }

  /** What the last call brought into escrow, and what it paid to an address. */
  get received(): bigint {
    return [...this.effects.unshieldedInputs.values()].reduce((a, b) => a + b, 0n);
  }
  paidTo(to: Uint8Array): bigint {
    return [...this.effects.claimedUnshieldedSpends.entries()].filter(([[, who]]) => who.address === hex(to)).reduce((a, [, v]) => a + v, 0n);
  }

  get ledger() {
    return ledger(this.state);
  }

  private expectPhase(phase: number, what: string) {
    if (this.ledger.phase !== phase) throw new Error(`${what}: phase is ${this.ledger.phase}, expected ${phase}`);
  }

  /** Runs keys and shuffles (unless a prepared deck served) and hole shares: the deal is ready to bet on. */
  async dealt() {
    await this.call(0, "start_deal");
    const l = this.ledger;
    const players = seatsOf(l);
    if (l.phase === Phase.keys) {
      for (const i of players) await this.call(i, "post_key", BigInt(i));
      for (const i of players) await this.call(i, "shuffle", BigInt(i));
    }
    for (const j of players) {
      const others = players.filter((i) => i !== j).flatMap((i) => [2 * players.indexOf(i), 2 * players.indexOf(i) + 1]);
      await this.call(j, "shares", BigInt(j), ten(others));
    }
    this.expectPhase(Phase.playing, "dealt");
  }

  /** The next deck: everyone in its preparation posts a key, then shuffles in turn. */
  async prepare() {
    const l = this.ledger;
    const players = [0, 1, 2, 3, 4, 5].filter((i) => l.next_in_deal[i]);
    for (const i of players) if (!l.next_has_key[i]) await this.call(i, "post_next_key", BigInt(i));
    while (this.ledger.next_prep === Prep.shuffle) {
      const s = Number(this.ledger.next_turn);
      await this.call(s, "shuffle_next", BigInt(s));
    }
    if (this.ledger.next_prep !== Prep.ready) throw new Error("prepare: the next deck is not ready");
  }

  /** Board positions for this table: the flop, turn and river slots. */
  board(street: 1 | 2 | 3): number[] {
    const holes = 2 * this.players.length;
    return street === 1 ? [holes, holes + 1, holes + 2] : street === 2 ? [holes + 3] : [holes + 4];
  }

  /** Everyone calls or checks the street down, then everyone still in releases the next one. */
  async checkAndRelease() {
    while (this.ledger.phase === Phase.playing) {
      const l = this.ledger;
      const s = Number(l.to_act);
      await this.call(s, "act", BigInt(s), l.bet[s]! < l.current_bet ? CALL : CHECK, 0n);
    }
    while (this.ledger.phase === Phase.release) {
      const l = this.ledger;
      const need = [0n, 3n, 4n, 5n][Number(l.release_street)]!;
      const released = (i: number) => l.board_shares.member(BigInt(i)) && l.board_shares.lookup(BigInt(i)) >= need;
      const s = seatsOf(l).find((i) => !l.folded[i] && !released(i))!;
      await this.call(s, "release", BigInt(s));
    }
  }

  /** Whoever is to act folds, until the deal is done. */
  async foldOut() {
    while (this.ledger.phase === Phase.playing) {
      const s = Number(this.ledger.to_act);
      await this.call(s, "act_out", BigInt(s), FOLD, 0n);
    }
    this.expectPhase(Phase.done, "foldOut");
  }

  /** Hands are being tabled: every player still in shows. */
  async tableAll() {
    while (this.ledger.phase === Phase.tabling) {
      const l = this.ledger;
      const s = seatsOf(l).find((i) => !l.folded[i] && shownCards(l, i) === null)!;
      await this.call(s, "show", BigInt(s));
    }
  }

  /** Every player still in proves their hand; returns the scores by seat. */
  async showAll(): Promise<Map<number, bigint>> {
    const scores = new Map<number, bigint>();
    for (const s of seatsOf(this.ledger)) {
      if (this.ledger.folded[s]) continue;
      scores.set(s, (await this.call(s, "show_hand", BigInt(s))) as bigint);
    }
    return scores;
  }
}
