import { ContractState, createCircuitContext, createConstructorContext, dummyContractAddress } from "@midnight-ntwrk/compact-runtime";
import { bestFive, cardName, forfeitSplit, holeCards, openCard, PRACTICE_ASSET, shownCards, splits } from "../../contracts/client.ts";
import { Contract, ledger, type Ledger } from "../../contracts/build/deal/contract/index.js";
import type { Card } from "../poker/cards.ts";
import { botAction } from "../poker/bot.ts";
import { CATEGORIES } from "../poker/hand.ts";
import type { Action, Legal, Referee, SeatView, Street, TableState } from "./types.ts";

// The referee is the compiled deal contract, run here against an in-memory ledger with no
// proofs (ADR 0003): the same circuits a live table verifies on Midnight. Every seat has
// its own secrets; the bots' never mix with yours. Every mechanical step (keys, shuffles,
// shares, releases, showing, settling) runs by itself for every seat, as a client would;
// only betting decisions wait for a human.

export interface ContractOptions {
  /** The players, in the order they join; the referee seats them at the first empty seat each time. */
  names: string[];
  /** Your index in `names`. */
  you: number;
  /** Bot think time and pause between deals, in ms. */
  botDelay?: [number, number];
  betweenDeals?: number;
}

type PS = Record<string, never>;
type State = Parameters<typeof createCircuitContext>[3];
type Circuit = "join" | "buy_in" | "start_deal" | "post_key" | "shuffle" | "shares" | "release" | "act" | "act_out" | "show" | "show_hand" | "settle" | "settle_abort";
type Arg = bigint | bigint[] | Uint8Array;
const UNTIMED = new Set<Circuit>(["join", "buy_in", "settle", "settle_abort"]);
const MIN_BUY_IN = 80;
const MAX_BUY_IN = 200;
const Phase = { idle: 0, keys: 1, shuffle: 2, holes: 3, playing: 4, release: 5, tabling: 6, showdown: 7, done: 8, aborted: 9 };
const STREETS: Street[] = ["preflop", "flop", "turn", "river"];
const BOARD_LEN = [0, 3, 4, 5];
const BIG_BLIND = 2;
const NONE = 255n;
const ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const coinPublicKey = "11".repeat(32);
const address = dummyContractAddress();

function randomScalar(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return (n % (ORDER - 1n)) + 1n;
}

function randomPermutation(): number[] {
  const p = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  return p;
}

/** Ten positions for the `shares` circuit: fewer are padded by repeating the last one. */
const ten = (positions: number[]): bigint[] => Array.from({ length: 10 }, (_, i) => BigInt(positions[Math.min(i, positions.length - 1)]!));
const seatsOf = (l: Ledger) => [0, 1, 2, 3, 4, 5].filter((i) => l.in_deal[i]);

/** One player's private state and its view of the contract. A fresh deck key every deal. */
class Seat {
  readonly contract: Contract<PS>;
  x = randomScalar();
  /** The seat the referee gave this player; -1 until joined. */
  index = -1;

  constructor(readonly name: string) {
    const secret = randomScalar();
    this.contract = new Contract<PS>({
      player_secret: (ctx) => [ctx.privateState, secret],
      deck_key: (ctx) => [ctx.privateState, this.x],
      permuted: (ctx) => [ctx.privateState, randomPermutation().map((k) => ctx.ledger.deck[k]!)],
      blinding: (ctx) => [ctx.privateState, Array.from({ length: 52 }, randomScalar)],
      best_five: (ctx) => [ctx.privateState, bestFive(ctx.ledger, this.index, this.x)],
      split_share: (ctx) => [ctx.privateState, splits(ctx.ledger).share],
      split_odd: (ctx) => [ctx.privateState, splits(ctx.ledger).odd],
      forfeit_share: (ctx) => [ctx.privateState, forfeitSplit(ctx.ledger).share],
      forfeit_odd: (ctx) => [ctx.privateState, forfeitSplit(ctx.ledger).odd],
    });
  }

  /** Where this player's stack and bond go back to. Practice chips go nowhere real. */
  readonly address = crypto.getRandomValues(new Uint8Array(32));
}

export class ContractReferee implements Referee {
  /** Seat -> name, as the referee seated the players; null for an empty seat. */
  private readonly names: (string | null)[] = [null, null, null, null, null, null];
  private you = -1;
  private readonly players: Seat[];
  private readonly yourIndex: number;
  private readonly botDelay: [number, number];
  private readonly betweenDeals: number;
  private readonly seats: (Seat | null)[] = [null, null, null, null, null, null];
  private state: State | null = null;
  private lastAction: (string | null)[];
  private message = "";
  private winners: number[] = [];
  private stackBefore: number[] = [];
  private lastStreet = -1n;
  private listeners = new Set<(s: TableState) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private driving = false;
  private stopped = false;

  constructor(o: ContractOptions) {
    this.players = o.names.map((n) => new Seat(n));
    this.yourIndex = o.you;
    this.botDelay = o.botDelay ?? [700, 1600];
    this.betweenDeals = o.betweenDeals ?? 4000;
    this.lastAction = this.names.map(() => null);
  }

  async start() {
    const first = this.players[0]!;
    this.state = (await first.contract.initialState(createConstructorContext<PS>({}, coinPublicKey), PRACTICE_ASSET)).currentContractState;
    // Everyone joins in turn; the contract hands out the seats.
    for (const [i, p] of this.players.entries()) {
      // join is called on this player's contract by their own (not yet seated) index.
      const ctx = createCircuitContext("join", address, coinPublicKey, this.state!, {} as PS);
      const r = await p.contract.circuits.join(ctx, p.address, BigInt(MAX_BUY_IN));
      this.state = r.context.callContext.currentQueryContext.state;
      p.index = Number(r.result);
      this.seats[p.index] = p;
      this.names[p.index] = p.name;
      if (i === this.yourIndex) this.you = p.index;
    }
    this.publish();
    await this.nextDeal();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  subscribe(fn: (s: TableState) => void) {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => void this.listeners.delete(fn);
  }

  async act(action: Action) {
    const l = this.ledger;
    if (l.phase !== Phase.playing || Number(l.to_act) !== this.you) throw new Error("not your turn");
    await this.perform(this.you, action);
    await this.drive();
  }

  async show() {
    if (!this.canShow(this.ledger)) throw new Error("nothing to show");
    await this.call(this.you, "show", BigInt(this.you));
    this.publish();
  }

  /** Once the deal is over, a player dealt in may open their cards, once. */
  private canShow(l: Ledger): boolean {
    const over = l.phase === Phase.showdown || l.phase === Phase.done || l.phase === Phase.aborted;
    return over && !!l.in_deal[this.you] && shownCards(l, this.you) === null;
  }

  private get ledger() {
    // The constructor hands back a ContractState; every call after that a charged state value.
    const s = this.state!;
    return ledger(s instanceof ContractState ? s.data : s);
  }

  private async call(seat: number, circuit: Circuit, ...args: Arg[]): Promise<unknown> {
    const now = Math.floor(Date.now() / 1000);
    const ctx = createCircuitContext(circuit, address, coinPublicKey, this.state!, {} as PS, undefined, undefined, undefined, now);
    const all = UNTIMED.has(circuit) ? args : [...args, BigInt(now)];
    const contract = this.seats[seat]!.contract;
    const r = await (contract.circuits[circuit] as (c: typeof ctx, ...a: Arg[]) => Promise<{ context: typeof ctx; result: unknown }>)(ctx, ...all);
    this.state = r.context.callContext.currentQueryContext.state;
    return r.result;
  }

  /** A betting action as the circuit it is: leaving chips behind or not. */
  private async perform(seat: number, action: Action) {
    const l = this.ledger;
    const legal = this.legal(seat);
    const stack = Number(l.stack[seat]);
    const bet = Number(l.bet[seat]);
    const [FOLD, CHECK, CALL, RAISE] = [0n, 0n, 1n, 2n];
    switch (action.type) {
      case "fold":
        await this.call(seat, "act_out", BigInt(seat), FOLD, 0n);
        break;
      case "check":
        await this.call(seat, "act", BigInt(seat), CHECK, 0n);
        break;
      case "call":
        await this.call(seat, legal.call >= stack ? "act_out" : "act", BigInt(seat), CALL, 0n);
        break;
      case "raise":
        await this.call(seat, action.to - bet >= stack ? "act_out" : "act", BigInt(seat), RAISE, BigInt(action.to));
        break;
    }
    this.lastAction[seat] =
      action.type === "raise" ? `${Number(l.current_bet) === 0 ? "bet" : "raise to"} ${action.to}` : action.type === "call" ? `call ${legal.call}` : action.type;
  }

  /** The contract's betting rules, for the rail and the bots. */
  private legal(seat: number): Legal {
    const l = this.ledger;
    if (l.phase !== Phase.playing || Number(l.to_act) !== seat) return { check: false, call: 0, raise: null };
    const stack = Number(l.stack[seat]);
    const bet = Number(l.bet[seat]);
    const current = Number(l.current_bet);
    const toCall = current - bet;
    const actors = seatsOf(l).filter((i) => !l.folded[i] && !l.all_in[i]).length;
    let raise: Legal["raise"] = null;
    if (stack > toCall && actors > 1 && !l.acted[seat]) {
      const max = bet + stack;
      const min = Math.min(max, current === 0 ? BIG_BLIND : current + Number(l.min_raise));
      raise = { min, max };
    }
    return { check: toCall === 0, call: toCall === 0 ? 0 : Math.min(toCall, stack), raise };
  }

  private async nextDeal() {
    if (this.stopped) return;
    // Practice chips are free, but results should still show: a seat buys back in to the
    // maximum only once it has dropped under the minimum buy-in.
    for (const seat of this.seats) {
      if (!seat || !this.ledger.seat_owner.member(BigInt(seat.index))) continue; // an evicted seat stays empty
      const stack = Number(this.ledger.stack[seat.index]);
      if (stack < MIN_BUY_IN) await this.call(seat.index, "buy_in", BigInt(seat.index), BigInt(MAX_BUY_IN - stack));
    }
    const l = this.ledger;
    this.stackBefore = l.stack.map(Number);
    this.lastAction = this.lastAction.map(() => null);
    this.message = "";
    this.winners = [];
    this.lastStreet = -1n;
    try {
      await this.call(this.players[0]!.index, "start_deal");
    } catch (e) {
      // Fewer than two seats with chips: the game is over.
      this.message = "Game over";
      this.publish();
      return;
    }
    await this.drive();
  }

  /** Runs every step that needs no decision, until a human's turn, a bot's think time, or the pause between deals. */
  private async drive() {
    if (this.driving || this.stopped) return;
    this.driving = true;
    try {
      for (;;) {
        const l = this.ledger;
        const live = seatsOf(l).filter((i) => !l.folded[i]);
        if (l.street !== this.lastStreet) {
          this.lastAction = this.lastAction.map(() => null);
          this.lastStreet = l.street;
        }
        switch (l.phase) {
          case Phase.keys:
            this.message = "Dealing";
            for (const s of seatsOf(l)) {
              if (l.keys.member(BigInt(s))) continue;
              this.seats[s]!.x = randomScalar();
              await this.call(s, "post_key", BigInt(s));
            }
            break;
          case Phase.shuffle: {
            const s = Number(l.turn);
            this.message = `${this.names[s]} shuffles`;
            this.publish();
            await this.call(s, "shuffle", BigInt(s));
            break;
          }
          case Phase.holes:
            this.message = "Dealing";
            for (const s of seatsOf(l)) {
              const order = seatsOf(l); // positions go by dealing order, not seat number
              const need = BigInt(order.length * 2 - 2);
              if (l.hole_shares.member(BigInt(s)) && l.hole_shares.lookup(BigInt(s)) >= need) continue;
              const others = order.filter((i) => i !== s).flatMap((i) => [2 * order.indexOf(i), 2 * order.indexOf(i) + 1]);
              await this.call(s, "shares", BigInt(s), ten(others));
            }
            break;
          case Phase.release: {
            const need = BigInt(BOARD_LEN[Number(l.release_street)]!);
            for (const s of live) {
              if (l.board_shares.member(BigInt(s)) && l.board_shares.lookup(BigInt(s)) >= need) continue;
              await this.call(s, "release", BigInt(s));
            }
            break;
          }
          case Phase.playing: {
            this.message = "";
            const s = Number(l.to_act);
            this.publish();
            if (s === this.you) return;
            const [lo, hi] = this.botDelay;
            this.timer = setTimeout(async () => {
              this.timer = null;
              if (this.stopped) return;
              await this.perform(s, botAction(this.legal(s)));
              await this.drive();
            }, lo + Math.random() * (hi - lo));
            return;
          }
          case Phase.tabling:
            // Nobody can bet any more: every hand still in is shown before the board runs out.
            this.message = "Hands are tabled";
            this.publish();
            for (const s of live) if (shownCards(l, s) === null) await this.call(s, "show", BigInt(s));
            break;
          case Phase.showdown:
            this.message = "Showdown";
            this.publish();
            for (const s of live) if (!l.scores.member(BigInt(s))) await this.call(s, "show_hand", BigInt(s));
            await this.call(live[0]!, "settle");
            break;
          case Phase.aborted:
            await this.call(this.players[0]!.index, "settle_abort"); // permissionless; any contract instance will do
            break;
          default: {
            // done: say who won, pause, deal again.
            this.finishDeal();
            this.publish();
            this.timer = setTimeout(() => {
              this.timer = null;
              void this.nextDeal();
            }, this.betweenDeals);
            return;
          }
        }
        this.publish();
        await new Promise((r) => setTimeout(r, 0)); // let the scene draw between steps
      }
    } finally {
      this.driving = false;
    }
  }

  private finishDeal() {
    const l = this.ledger;
    if (Number(l.offender) !== 255) {
      this.message = `Deal aborted: ${this.names[Number(l.offender)] ?? "someone"} did not act in time and leaves the table`;
      return;
    }
    // Won = stack now, less what it was before the deal, plus what went into the pot.
    const payouts = l.stack.map((s, i) => Number(s) - (this.stackBefore[i] ?? 0) + Number(l.total[i]));
    this.winners = payouts.map((p, i) => (p > 0 ? i : -1)).filter((i) => i >= 0);
    this.message = this.winners
      .map((w) => {
        const who = w === this.you ? "You" : this.names[w];
        const how = l.scores.member(BigInt(w)) ? ` with ${CATEGORIES[Number(l.scores.lookup(BigInt(w)) / 15n ** 5n)]}` : "";
        return `${who} win${w === this.you ? "" : "s"} ${payouts[w]}${how}`;
      })
      .join(", ");
  }

  private publish() {
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }

  private snapshot(): TableState {
    if (!this.state) {
      // Before start(): the seats are known, nothing has happened.
      return {
        seats: this.names.map((name) => ({ name, stack: 0, bet: 0, inHand: false, folded: false, allIn: false, hole: null, lastAction: null, isWinner: false })),
        dealer: -1,
        street: "between",
        board: [],
        pot: 0,
        toAct: null,
        you: this.you,
        legal: null,
        bigBlind: BIG_BLIND,
        message: "",
        canShow: false,
      };
    }
    const l = this.ledger;
    const phase = l.phase;
    // A finished deal stays on the table (cards, bets, the winner) until the next one starts.
    const inDeal = phase >= Phase.keys;
    const betting = phase >= Phase.playing && phase <= Phase.showdown;
    let mine: Card[] | null = null;
    if (betting || phase === Phase.done) {
      try {
        mine = holeCards(l, this.you, this.seats[this.you]!.x).map(cardName);
      } catch {
        mine = null; // your seat is not in this deal
      }
    }
    let board: Card[] = [];
    if (betting || phase === Phase.done) {
      // Only the streets released so far can be opened; later positions still lack shares.
      const holes = 2 * Number(l.n_players);
      try {
        board = Array.from({ length: BOARD_LEN[Number(l.street)]! }, (_, i) => cardName(openCard(l, holes + i)));
      } catch {
        board = []; // a release still in progress
      }
    }
    // Another seat's cards are readable only once that seat has shown them.
    const shown = (i: number): Card[] | null => (betting || phase === Phase.done || phase === Phase.aborted) && l.in_deal[i] ? (shownCards(l, i)?.map(cardName) ?? null) : null;
    const seats: SeatView[] = this.names.map((name, i) => ({
      name,
      stack: Number(l.stack[i]),
      bet: inDeal ? Number(l.bet[i]) : 0,
      // A shown hand stays face up on the felt, folded or not.
      inHand: inDeal && l.in_deal[i]! && (!l.folded[i]! || shown(i) !== null),
      folded: inDeal && l.folded[i]!,
      allIn: inDeal && l.all_in[i]!,
      hole: i === this.you ? (l.in_deal[i] ? mine : null) : shown(i),
      lastAction: this.lastAction[i] ?? null,
      isWinner: this.winners.includes(i),
    }));
    return {
      seats,
      dealer: Number(l.dealer) === 255 ? -1 : Number(l.dealer),
      street: phase === Phase.showdown ? "showdown" : phase === Phase.playing || phase === Phase.release || phase === Phase.tabling ? STREETS[Number(l.street)]! : "between",
      board,
      pot: l.total.reduce((a, b) => a + Number(b), 0),
      toAct: phase === Phase.playing && l.to_act !== NONE ? Number(l.to_act) : null,
      you: this.you,
      legal: phase === Phase.playing && Number(l.to_act) === this.you ? this.legal(this.you) : null,
      bigBlind: BIG_BLIND,
      message: this.message,
      canShow: this.canShow(l),
    };
  }
}
