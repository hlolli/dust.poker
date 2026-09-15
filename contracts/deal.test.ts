import { expect, test } from "bun:test";
import {
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
  ecAdd,
  ecMul,
  ecNeg,
  type JubjubPoint,
} from "@midnight-ntwrk/compact-runtime";
import { evaluate } from "../src/poker/hand.ts";
import { settle as settleTs } from "../src/poker/payout.ts";
import { Contract, ledger, pureCircuits } from "./build/deal/contract/index.js";
import { bestFive, boardCards, cardName, holeCards, orderOf, shownCards, splits } from "./client.ts";

// Deals executed locally through the referee: seats, phases, turns, deadlines, and the
// betting of src/poker/deal.test.ts replayed against the contract. No chain, no proofs;
// this is the Practice path and the correctness half of the benchmark.

const ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const coinPublicKey = "11".repeat(32);
const address = dummyContractAddress();
type PS = Record<string, never>;
type State = Parameters<typeof createCircuitContext>[3];
type Circuit = "sit" | "buy_in" | "start_deal" | "post_key" | "shuffle" | "shares" | "release" | "act" | "act_out" | "show" | "show_hand" | "settle" | "expire";
const Phase = { idle: 0, keys: 1, shuffle: 2, holes: 3, playing: 4, release: 5, tabling: 6, showdown: 7, done: 8, aborted: 9 };
const [FOLD, CHECK, CALL, RAISE] = [0n, 0n, 1n, 2n];
const NONE = 255n;
const T0 = 1_700_000_000; // block time, seconds

function randomScalar(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return (n % (ORDER - 1n)) + 1n;
}

function randomPermutation(): bigint[] {
  const p = Array.from({ length: 52 }, (_, i) => BigInt(i));
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  return p;
}

function player(permutation: bigint[] = randomPermutation()) {
  const secret = randomScalar();
  const x = randomScalar();
  const blinding = Array.from({ length: 52 }, randomScalar);
  const p = { x, seat: -1, contract: null as unknown as Contract<PS> };
  p.contract = new Contract<PS>({
    player_secret: (ctx) => [ctx.privateState, secret],
    deck_key: (ctx) => [ctx.privateState, x],
    // The circuit takes the deck already in secret order; the permutation itself stays here.
    permuted: (ctx) => [ctx.privateState, permutation.map((k) => ctx.ledger.deck[Number(k)]!)],
    blinding: (ctx) => [ctx.privateState, blinding],
    // Showdown witnesses, computed from the ledger as a client would.
    best_five: (ctx) => [ctx.privateState, bestFive(ctx.ledger, p.seat, x)],
    split_share: (ctx) => [ctx.privateState, splits(ctx.ledger).share],
    split_odd: (ctx) => [ctx.privateState, splits(ctx.ledger).odd],
  });
  return p;
}
type Player = ReturnType<typeof player>;

/** A table: players in seats 0..n-1 and a clock; every call states the clock as `now`. */
class Table {
  now = T0;
  state!: State;
  constructor(readonly players: Player[]) {}

  static async seated(n: number, players = Array.from({ length: n }, () => player())): Promise<Table> {
    const t = new Table(players);
    t.state = (await players[0]!.contract.initialState(createConstructorContext<PS>({}, coinPublicKey))).currentContractState;
    for (let i = 0; i < players.length; i++) {
      players[i]!.seat = i;
      await t.call(i, "sit", BigInt(i));
    }
    return t;
  }

  /** Circuits that take the clock get it appended. */
  async call(seat: number, circuit: Circuit, ...args: (bigint | bigint[])[]): Promise<unknown> {
    const timed = circuit !== "sit" && circuit !== "buy_in" && circuit !== "expire" && circuit !== "settle";
    const p = this.players[seat]!;
    const ctx = createCircuitContext(circuit, address, coinPublicKey, this.state, {} as PS, undefined, undefined, undefined, this.now);
    const all = timed ? [...args, BigInt(this.now)] : args;
    const r = await (p.contract.circuits[circuit] as (c: typeof ctx, ...a: (bigint | bigint[])[]) => Promise<{ context: typeof ctx; result: unknown }>)(ctx, ...all);
    this.state = r.context.callContext.currentQueryContext.state;
    return r.result;
  }

  /** A call expected to fail leaves the state alone. */
  refuses(seat: number, circuit: Circuit, pattern: RegExp, ...args: (bigint | bigint[])[]) {
    const before = this.state;
    return expect(this.call(seat, circuit, ...args).finally(() => (this.state = before))).rejects.toThrow(pattern);
  }

  get ledger() {
    return ledger(this.state);
  }

  /** Runs keys, shuffles and hole shares: the deal is ready to bet on. */
  async dealt() {
    const n = this.players.length;
    await this.call(0, "start_deal");
    for (let i = 0; i < n; i++) await this.call(i, "post_key", BigInt(i));
    for (let i = 0; i < n; i++) await this.call(i, "shuffle", BigInt(i));
    for (let j = 0; j < n; j++) {
      const others = Array.from({ length: n }, (_, i) => i).filter((i) => i !== j).flatMap((i) => [2 * i, 2 * i + 1]);
      await this.call(j, "shares", BigInt(j), ten(others));
    }
    expect(this.ledger.phase).toBe(Phase.playing);
  }

  /** Board positions for this table: the flop, turn and river slots. */
  board(street: 1 | 2 | 3): number[] {
    const holes = 2 * this.players.length;
    return street === 1 ? [holes, holes + 1, holes + 2] : street === 2 ? [holes + 3] : [holes + 4];
  }

  /** Everyone checks the street down, then everyone still in releases the next one. */
  async checkAndRelease() {
    while (this.ledger.phase === Phase.playing) {
      const s = Number(this.ledger.to_act);
      await this.call(s, "act", BigInt(s), CHECK, 0n);
    }
    while (this.ledger.phase === Phase.release) {
      const l = this.ledger;
      const need = [0n, 3n, 4n, 5n][Number(l.release_street)]!;
      const released = (i: number) => l.board_shares.member(BigInt(i)) && l.board_shares.lookup(BigInt(i)) >= need;
      const s = seatsOf(l).find((i) => !l.folded[i] && !released(i))!;
      await this.call(s, "release", BigInt(s));
    }
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

const seatsOf = (l: ReturnType<typeof ledger>) => [0, 1, 2, 3, 4, 5].filter((i) => l.in_deal[i]);

/** What src/poker says the payouts are, from the cards every player can now read. */
function expectedPayouts(t: Table): number[] {
  const l = t.ledger;
  const board = boardCards(l).map(cardName);
  const contenders = [0, 1, 2, 3, 4, 5].map((i) => {
    if (!l.in_deal[i]) return null;
    const folded = l.folded[i]!;
    const score = folded ? 0 : evaluate([...holeCards(l, i, t.players[i]!.x).map(cardName), ...board]).score;
    return { total: Number(l.total[i]), folded, score };
  });
  return settleTs(contenders, Number(l.dealer));
}

/** Ten positions for the `shares` circuit: fewer are padded by repeating the last one. */
const ten = (positions: number[]): bigint[] => Array.from({ length: 10 }, (_, i) => BigInt(positions[Math.min(i, positions.length - 1)]!));

const same = (p: JubjubPoint, q: JubjubPoint) => p.x === q.x && p.y === q.y;
const cardTable = Array.from({ length: 52 }, (_, k) => pureCircuits.card_point(BigInt(k)));
const cardIndex = (m: JubjubPoint) => cardTable.findIndex((c) => same(c, m));

test("six players deal a deck through the phases; each reads only their own cards and the board", async () => {
  const t = await Table.seated(6);
  const l0 = t.ledger;
  expect(l0.stack).toEqual([200n, 200n, 200n, 200n, 200n, 200n]);

  await t.call(3, "start_deal"); // anyone may start
  expect(t.ledger.phase).toBe(Phase.keys);
  expect(t.ledger.n_players).toBe(6n);
  expect(t.ledger.deal_no).toBe(1n);
  expect(t.ledger.dealer).toBe(0n);
  expect(t.ledger.bet).toEqual([0n, 1n, 2n, 0n, 0n, 0n]); // blinds are in before the cards

  let clock = performance.now();
  for (let i = 0; i < 6; i++) await t.call(i, "post_key", BigInt(i));
  const keysMs = performance.now() - clock;
  expect(t.ledger.phase).toBe(Phase.shuffle);
  expect(t.ledger.turn).toBe(0n);
  await t.refuses(0, "post_key", /not posting keys/, 0n);
  await t.refuses(1, "shuffle", /not your turn/, 1n);
  await t.refuses(1, "shuffle", /not your seat/, 0n);

  clock = performance.now();
  for (let i = 0; i < 6; i++) await t.call(i, "shuffle", BigInt(i));
  const shuffleMs = performance.now() - clock;
  expect(t.ledger.shuffles_done).toBe(6n);
  expect(t.ledger.phase).toBe(Phase.holes);

  // Positions: seat i holds 2i and 2i+1; the board is 12..16.
  const holes = (i: number) => [2 * i, 2 * i + 1];
  await t.refuses(2, "shares", /own hole card/, 2n, ten([4, 5]));
  await t.refuses(2, "shares", /not released yet/, 2n, ten([40]));
  await t.refuses(2, "shares", /not released yet/, 2n, ten([12]));
  await t.refuses(2, "release", /nothing to release/, 2n);

  clock = performance.now();
  for (let j = 0; j < 6; j++) {
    const others = Array.from({ length: 6 }, (_, i) => i).filter((i) => i !== j).flatMap(holes);
    await t.call(j, "shares", BigInt(j), ten(others));
    expect(t.ledger.phase).toBe(j === 5 ? Phase.playing : Phase.holes);
  }
  const shareMs = performance.now() - clock;
  expect(t.ledger.to_act).toBe(3n); // left of the big blind

  // Everyone but the big blind folds: the pot is theirs, and their board shares are on the ledger.
  for (const seat of [3, 4, 5, 0, 1]) await t.call(seat, "act_out", BigInt(seat), FOLD, 0n);
  const l = t.ledger;
  expect(l.phase).toBe(Phase.done);
  expect(l.stack[2]).toBe(201n);
  expect(l.stack[1]).toBe(199n);

  const share = (pos: number, seat: number) => l.shares_posted.lookup(BigInt(pos * 8 + seat));
  const read = (pos: number, reader: number): number => {
    const c = l.deck[pos]!;
    let m = c.b;
    // Every posted share except the reader's own; the holder's share of their own card is never posted.
    for (let seat = 0; seat < 6; seat++) {
      if (seat !== reader && l.shares_posted.member(BigInt(pos * 8 + seat))) m = ecAdd(m, ecNeg(share(pos, seat)));
    }
    m = ecAdd(m, ecNeg(ecMul(c.a, t.players[reader]!.x)));
    return cardIndex(m);
  };
  const dealt: number[] = [];
  for (let i = 0; i < 6; i++) for (const pos of holes(i)) dealt.push(read(pos, i));
  expect(dealt.every((k) => k >= 0 && k < 52)).toBe(true);
  expect(new Set(dealt).size).toBe(12);
  // The board is not readable: the winner never posted board shares, and never has to.
  expect(l.shares_posted.member(BigInt(12 * 8 + 2))).toBe(false);
  expect(l.shares_posted.member(BigInt(12 * 8 + 3))).toBe(true);
  // A hole card is unreadable without its holder's key: the wrong key decodes to no card.
  expect(read(0, 1)).toBe(-1);

  // The next deal starts from done, moves the button and resets the deck.
  t.now += 60;
  await t.call(0, "start_deal");
  expect(t.ledger.deal_no).toBe(2n);
  expect(t.ledger.dealer).toBe(1n);
  expect(t.ledger.phase).toBe(Phase.keys);
  expect(t.ledger.shares_posted.isEmpty()).toBe(true);
  expect(same(t.ledger.deck[0]!.b, cardTable[0]!)).toBe(true);

  console.log(`local dealing: keys ${keysMs.toFixed(0)} ms, 6 shuffles ${shuffleMs.toFixed(0)} ms, 6 share batches ${shareMs.toFixed(0)} ms`);
}, 120_000);

test("three-handed: blinds, order, and folding to the big blind", async () => {
  const t = await Table.seated(3);
  await t.dealt();
  // Dealer 0; SB is 1, BB is 2; seat 0 acts first preflop.
  expect(t.ledger.bet).toEqual([0n, 1n, 2n, 0n, 0n, 0n]);
  expect(t.ledger.to_act).toBe(0n);
  await t.refuses(1, "act_out", /not your turn/, 1n, FOLD, 0n);
  await t.call(0, "act_out", 0n, FOLD, 0n);
  await t.call(1, "act_out", 1n, FOLD, 0n);
  expect(t.ledger.phase).toBe(Phase.done);
  expect(t.ledger.stack.slice(0, 3)).toEqual([200n, 199n, 201n]);
}, 60_000);

test("big blind gets the option, then the flop is released and action starts left of the dealer", async () => {
  const t = await Table.seated(3);
  await t.dealt();
  await t.call(0, "act", 0n, CALL, 0n);
  await t.call(1, "act", 1n, CALL, 0n);
  expect(t.ledger.phase).toBe(Phase.playing);
  expect(t.ledger.to_act).toBe(2n); // the option
  await t.refuses(2, "act", /nothing to call/, 2n, CALL, 0n);
  await t.call(2, "act", 2n, CHECK, 0n);
  expect(t.ledger.phase).toBe(Phase.release);
  expect(t.ledger.release_street).toBe(1n);
  await t.refuses(1, "act", /no betting now/, 1n, CHECK, 0n);
  await t.refuses(1, "shares", /no hole shares wanted/, 1n, ten(t.board(2)));
  for (let i = 0; i < 3; i++) {
    await t.call(i, "release", BigInt(i));
    expect(t.ledger.phase).toBe(i === 2 ? Phase.playing : Phase.release);
  }
  expect(t.ledger.street).toBe(1n);
  expect(t.ledger.to_act).toBe(1n);
  expect(t.ledger.current_bet).toBe(0n);
  expect(t.ledger.bet.slice(0, 3)).toEqual([0n, 0n, 0n]);
  await t.refuses(1, "act", /outside the legal range/, 1n, RAISE, 1n); // the minimum bet is a big blind
  await t.call(1, "act", 1n, RAISE, 2n);
  expect(t.ledger.current_bet).toBe(2n);
  expect(t.ledger.to_act).toBe(2n);
}, 60_000);

test("a full raise reopens the action and sets the min-raise; calls close the street", async () => {
  const t = await Table.seated(3);
  await t.dealt();
  await t.call(0, "act", 0n, RAISE, 6n); // raise by 4
  await t.refuses(1, "act", /outside the legal range/, 1n, RAISE, 9n); // next raise is at least to 10
  await t.call(1, "act", 1n, RAISE, 20n); // raise by 14
  expect(t.ledger.min_raise).toBe(14n);
  await t.call(2, "act", 2n, RAISE, 34n); // the minimum re-raise, another 14
  expect(t.ledger.min_raise).toBe(14n);
  // Seat 0 faces a full raise and may re-raise, to at least 48; it calls.
  expect(t.ledger.to_act).toBe(0n);
  await t.refuses(0, "act", /outside the legal range/, 0n, RAISE, 40n);
  await t.call(0, "act", 0n, CALL, 0n);
  // Seat 1 was reopened by seat 2's raise; a check is refused with a bet to call, a call closes the street.
  expect(t.ledger.to_act).toBe(1n);
  await t.refuses(1, "act", /there is a bet to call/, 1n, CHECK, 0n);
  await t.call(1, "act", 1n, CALL, 0n);
  expect(t.ledger.phase).toBe(Phase.release);
  expect(t.ledger.total.slice(0, 3)).toEqual([34n, 34n, 34n]);
  expect(t.ledger.stack.slice(0, 3)).toEqual([166n, 166n, 166n]);
}, 60_000);

test("all in and called runs the board out to a showdown without waiting on anyone", async () => {
  const t = await Table.seated(3);
  await t.dealt();
  await t.refuses(0, "act", /leaves you all in/, 0n, RAISE, 200n);
  await t.refuses(0, "act_out", /leaves chips behind/, 0n, RAISE, 100n);
  await t.call(0, "act_out", 0n, RAISE, 200n);
  expect(t.ledger.all_in[0]).toBe(true);
  await t.call(1, "act_out", 1n, CALL, 0n);
  await t.call(2, "act_out", 2n, CALL, 0n);
  // Everyone is all in: hands are tabled first, then, every board share having come with
  // the all-ins, straight to showdown.
  expect(t.ledger.phase).toBe(Phase.tabling);
  await t.refuses(0, "show_hand", /not at showdown/, 0n);
  await t.tableAll();
  expect(t.ledger.phase).toBe(Phase.showdown);
  expect(t.ledger.street).toBe(3n);
  expect(t.ledger.stack.slice(0, 3)).toEqual([0n, 0n, 0n]);
  for (const pos of [6, 7, 8, 9, 10]) for (let seat = 0; seat < 3; seat++) expect(t.ledger.shares_posted.member(BigInt(pos * 8 + seat))).toBe(true);
  // Everyone's hole cards are readable by anyone now, and they are the cards the holders see.
  for (let seat = 0; seat < 3; seat++) expect(shownCards(t.ledger, seat)).toEqual(holeCards(t.ledger, seat, t.players[seat]!.x));
}, 60_000);

test("show your bluff: after a deal anyone dealt in may open their own cards, and nobody else can", async () => {
  const t = await Table.seated(3);
  await t.dealt();
  await t.refuses(0, "show", /nothing to show yet/, 0n);
  await t.call(0, "act_out", 0n, FOLD, 0n);
  await t.call(1, "act_out", 1n, FOLD, 0n);
  expect(t.ledger.phase).toBe(Phase.done);
  for (let seat = 0; seat < 3; seat++) expect(shownCards(t.ledger, seat)).toBeNull();
  await t.call(2, "show", 2n); // the winner shows the bluff
  await t.call(0, "show", 0n); // a folded player may show too
  expect(shownCards(t.ledger, 2)).toEqual(holeCards(t.ledger, 2, t.players[2]!.x));
  expect(shownCards(t.ledger, 0)).toEqual(holeCards(t.ledger, 0, t.players[0]!.x));
  expect(shownCards(t.ledger, 1)).toBeNull();
  await t.refuses(1, "show", /does not match/, 2n); // only with the seat's own key
  // The next deal wipes the shares; nothing carries over.
  await t.call(0, "start_deal");
  expect(t.ledger.shares_posted.isEmpty()).toBe(true);
}, 60_000);

test("a player who does not table their hand in time aborts the deal on themselves", async () => {
  const t = await Table.seated(3);
  await t.dealt();
  await t.call(0, "act_out", 0n, RAISE, 200n);
  await t.call(1, "act_out", 1n, CALL, 0n);
  await t.call(2, "act_out", 2n, CALL, 0n);
  expect(t.ledger.phase).toBe(Phase.tabling);
  await t.call(1, "show", 1n);
  await t.call(2, "show", 2n);
  t.now += 60;
  await t.call(1, "expire");
  expect(t.ledger.phase).toBe(Phase.aborted);
  expect(t.ledger.offender).toBe(0n);
}, 60_000);

test("one player with chips left releases the whole board at once", async () => {
  const t = await Table.seated(3);
  // Deal 1 folds to the big blind, so seat 2 has 201 and can cover an all-in.
  await t.dealt();
  await t.call(0, "act_out", 0n, FOLD, 0n);
  await t.call(1, "act_out", 1n, FOLD, 0n);
  expect(t.ledger.stack.slice(0, 3)).toEqual([200n, 199n, 201n]);
  // Deal 2: button on 1, blinds 2 and 0, seat 1 acts first and shoves.
  await t.dealt();
  expect(t.ledger.dealer).toBe(1n);
  expect(t.ledger.to_act).toBe(1n);
  await t.call(1, "act_out", 1n, RAISE, 199n);
  await t.call(2, "act", 2n, CALL, 0n); // covers it with 2 behind
  await t.call(0, "act_out", 0n, FOLD, 0n);
  // Nobody can bet any more: hands are tabled, then seat 2, the only one whose board shares
  // are missing, releases the whole board.
  expect(t.ledger.phase).toBe(Phase.tabling);
  await t.tableAll();
  expect(t.ledger.phase).toBe(Phase.release);
  expect(t.ledger.release_street).toBe(3n);
  await t.refuses(1, "act", /no betting now/, 1n, CHECK, 0n);
  await t.call(2, "release", 2n);
  expect(t.ledger.phase).toBe(Phase.showdown);
  expect(t.ledger.street).toBe(3n);
}, 60_000);

test("showdown: three players check to the river, prove their hands, and the pot is paid", async () => {
  const t = await Table.seated(3);
  await t.dealt();
  await t.call(0, "act", 0n, CALL, 0n);
  await t.call(1, "act", 1n, CALL, 0n);
  await t.call(2, "act", 2n, CHECK, 0n);
  for (let street = 1; street <= 3; street++) {
    await t.checkAndRelease();
    expect(t.ledger.street).toBe(BigInt(street));
  }
  await t.checkAndRelease();
  expect(t.ledger.phase).toBe(Phase.showdown);
  await t.refuses(0, "settle", /not everyone has shown/);

  // Each proof's score is exactly what src/poker/hand.ts gives the same seven cards.
  const scores = await t.showAll();
  const l = t.ledger;
  const board = boardCards(l).map(cardName);
  for (const [s, score] of scores) {
    const seven = [...holeCards(l, s, t.players[s]!.x).map(cardName), ...board];
    expect(score).toBe(BigInt(evaluate(seven).score));
    expect(l.scores.lookup(BigInt(s))).toBe(score);
  }
  await t.refuses(0, "show_hand", /already shown/, 0n);

  const before = l.stack.map(Number);
  const payouts = expectedPayouts(t);
  await t.call(1, "settle");
  expect(t.ledger.phase).toBe(Phase.done);
  expect(t.ledger.stack.map(Number)).toEqual(before.map((s, i) => s + payouts[i]!));
  expect(t.ledger.stack.slice(0, 3).reduce((a, b) => a + b, 0n)).toBe(600n);

  // The next deal starts from done.
  await t.call(0, "start_deal");
  expect(t.ledger.deal_no).toBe(2n);
}, 120_000);

test("showdown with side pots: a short all-in, a covering all-in, and a caller with chips", async () => {
  const t = await Table.seated(3);
  await t.dealt();
  await t.call(0, "act_out", 0n, FOLD, 0n);
  await t.call(1, "act_out", 1n, FOLD, 0n); // seat 2 wins the blinds: 200, 199, 201
  await t.dealt(); // button on 1; blinds 2 (1) and 0 (2); seat 1 acts first
  await t.call(1, "act_out", 1n, RAISE, 199n); // all in for 199
  await t.call(2, "act", 2n, CALL, 0n); // 199 in, 2 behind
  await t.call(0, "act_out", 0n, RAISE, 200n); // all in for 200, a raise of one chip over the top
  await t.call(2, "act", 2n, CALL, 0n); // 200 in, 1 behind: the only one left to act
  expect(t.ledger.total.slice(0, 3)).toEqual([200n, 199n, 200n]);
  expect(t.ledger.phase).toBe(Phase.tabling);
  await t.tableAll();
  expect(t.ledger.phase).toBe(Phase.release);
  await t.call(2, "release", 2n);
  expect(t.ledger.phase).toBe(Phase.showdown);

  await t.showAll();
  const before = t.ledger.stack.map(Number);
  const payouts = expectedPayouts(t);
  await t.call(0, "settle");
  // Levels 199 (all three) and 200 (seats 0 and 2); the TS side pots agree with the contract.
  expect(t.ledger.stack.map(Number)).toEqual(before.map((s, i) => s + payouts[i]!));
  expect(t.ledger.stack.slice(0, 3).reduce((a, b) => a + b, 0n)).toBe(600n);
}, 120_000);

test("a player who does not show in time aborts the deal on themselves", async () => {
  const t = await Table.seated(2);
  await t.dealt();
  await t.call(0, "act_out", 0n, RAISE, 200n);
  await t.call(1, "act_out", 1n, CALL, 0n);
  await t.tableAll();
  expect(t.ledger.phase).toBe(Phase.showdown);
  await t.call(1, "show_hand", 1n);
  t.now += 90;
  await t.call(1, "expire");
  expect(t.ledger.phase).toBe(Phase.aborted);
  expect(t.ledger.offender).toBe(0n);
}, 60_000);

test("buying in again: between deals or while sitting out, up to the maximum", async () => {
  const t = await Table.seated(3);
  await t.refuses(0, "buy_in", /over the maximum/, 0n, 1n); // already at the maximum
  await t.dealt();
  await t.refuses(0, "buy_in", /in a deal/, 0n, 1n);
  // Seat 0 loses everything and sits out the next deal; it may buy in while that one runs.
  await t.call(0, "act_out", 0n, RAISE, 200n);
  await t.call(1, "act_out", 1n, CALL, 0n);
  await t.call(2, "act_out", 2n, FOLD, 0n);
  await t.tableAll();
  await t.showAll();
  await t.call(0, "settle");
  const broke = [0, 1].find((i) => t.ledger.stack[i] === 0n)!; // whoever lost the coin flip
  const rich = 1 - broke;
  await t.refuses(broke, "buy_in", /not your seat/, BigInt(rich), 10n);
  await t.refuses(broke, "buy_in", /under the minimum/, BigInt(broke), 79n);
  await t.refuses(broke, "buy_in", /over the maximum/, BigInt(broke), 201n);
  await t.call(broke, "buy_in", BigInt(broke), 120n);
  expect(t.ledger.stack[broke]).toBe(120n);
  await t.call(broke, "buy_in", BigInt(broke), 80n); // topping up to the maximum
  expect(t.ledger.stack[broke]).toBe(200n);
  await t.refuses(rich, "buy_in", /over the maximum/, BigInt(rich), 1n); // 400 behind: no more
}, 60_000);

test("heads up: the dealer posts the small blind and acts first preflop", async () => {
  const t = await Table.seated(2);
  await t.dealt();
  expect(t.ledger.dealer).toBe(0n);
  expect(t.ledger.bet.slice(0, 2)).toEqual([1n, 2n]);
  expect(t.ledger.to_act).toBe(0n);
}, 60_000);

test("illegal actions are refused and leave the deal untouched", async () => {
  const t = await Table.seated(3);
  await t.dealt();
  await t.refuses(0, "act", /there is a bet to call/, 0n, CHECK, 0n);
  await t.refuses(0, "act", /outside the legal range/, 0n, RAISE, 3n);
  await t.refuses(1, "act", /not your turn/, 1n, CALL, 0n);
  await t.refuses(0, "act", /not your seat/, 1n, CALL, 0n);
  expect(t.ledger.to_act).toBe(0n);
  expect(t.ledger.stack.slice(0, 3)).toEqual([200n, 199n, 198n]);
}, 60_000);

test("a shuffle that is not a permutation is rejected", async () => {
  const t = await Table.seated(2, [player(), player([0n, 0n, ...Array.from({ length: 50 }, (_, i) => BigInt(i + 2))])]);
  await t.call(0, "start_deal");
  await t.call(0, "post_key", 0n);
  await t.call(1, "post_key", 1n);
  await t.call(0, "shuffle", 0n);
  await t.refuses(1, "shuffle", /not a permutation/, 1n);
});

test("a share must match the seat's posted key", async () => {
  const t = await Table.seated(2);
  await t.call(0, "start_deal");
  await t.call(0, "post_key", 0n);
  await t.call(1, "post_key", 1n);
  await t.call(0, "shuffle", 0n);
  await t.call(1, "shuffle", 1n);
  await t.refuses(0, "shares", /does not match/, 1n, ten([0]));
});

test("the caller's clock must agree with the chain", async () => {
  const t = await Table.seated(2);
  const chain = t.now;
  const at = (claimed: number) => {
    t.now = claimed;
    const ctx = createCircuitContext("start_deal", address, coinPublicKey, t.state, {} as PS, undefined, undefined, undefined, chain);
    return t.players[0]!.contract.circuits.start_deal(ctx, BigInt(claimed));
  };
  await expect(at(chain + 1)).rejects.toThrow(/clock ahead/);
  await expect(at(chain - 120)).rejects.toThrow(/clock behind/);
  await at(chain - 119); // inside the slack
});

test("a missed deadline aborts the deal and names the seat that owed the step", async () => {
  const t = await Table.seated(3);
  await t.call(0, "start_deal");
  t.now += 59;
  await t.refuses(0, "expire", /deadline not reached/);

  // Keys phase: seat 1 never posts.
  const keys = new Table(t.players);
  keys.state = t.state;
  keys.now = t.now;
  await keys.call(0, "post_key", 0n);
  await keys.call(2, "post_key", 2n);
  keys.now += 1;
  await keys.call(1, "expire");
  expect(keys.ledger.phase).toBe(Phase.aborted);
  expect(keys.ledger.offender).toBe(1n);
  await keys.refuses(0, "expire", /nothing pending/);

  // Shuffle phase: the seat whose turn it is.
  for (let i = 0; i < 3; i++) await t.call(i, "post_key", BigInt(i));
  await t.call(0, "shuffle", 0n);
  expect(t.ledger.turn).toBe(1n);
  expect(t.ledger.deadline).toBe(BigInt(t.now + 240));
  t.now += 240;
  await t.call(2, "expire");
  expect(t.ledger.offender).toBe(1n);

  // An aborted deal can be restarted.
  await t.call(2, "start_deal");
  expect(t.ledger.phase).toBe(Phase.keys);
  expect(t.ledger.deal_no).toBe(2n);
}, 60_000);

test("the betting clock: a player who does not act in time aborts the deal on themselves", async () => {
  const t = await Table.seated(3);
  await t.dealt();
  expect(t.ledger.deadline).toBe(BigInt(t.now + 30));
  await t.call(0, "act", 0n, CALL, 0n);
  t.now += 30;
  await t.call(2, "expire");
  expect(t.ledger.phase).toBe(Phase.aborted);
  expect(t.ledger.offender).toBe(1n);

  // A release that never completes names the player who did not post their board shares.
  const u = await Table.seated(3);
  await u.dealt();
  await u.call(0, "act", 0n, CALL, 0n);
  await u.call(1, "act", 1n, CALL, 0n);
  await u.call(2, "act", 2n, CHECK, 0n);
  await u.call(0, "release", 0n);
  await u.call(2, "release", 2n);
  u.now += 90;
  await u.call(0, "expire");
  expect(u.ledger.offender).toBe(1n);
}, 60_000);
