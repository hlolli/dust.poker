import { ContractState, createCircuitContext, createConstructorContext, dummyContractAddress } from "@midnight-ntwrk/compact-runtime";
import { bestFive, forfeitSplit, PRACTICE_ASSET, prepForfeitSplit, splits } from "../../contracts/client.ts";
import { Contract, ledger } from "../../contracts/build/deal/contract/index.js";
import { botAction } from "../poker/bot.ts";
import { actionStep, type Arg, canShow, type Circuit, CLOCK_SLACK, emptyTable, legal, MAX_BUY_IN, MIN_BUY_IN, outcome, owed, Phase, Prep, tableFrom, UNTIMED } from "./rules.ts";
import type { Action, Referee, TableState } from "./types.ts";

// The Practice referee is the compiled deal contract, run here against an in-memory ledger
// with no proofs (ADR 0003): the same circuits a live table verifies on Midnight. Every seat
// has its own secrets; the bots' never mix with yours. Every mechanical step (keys, shuffles,
// shares, releases, showing, settling) runs by itself for every seat, as a client would; only
// betting decisions wait for a human. What is read off the ledger is shared with the Live
// referee (rules.ts).

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

/**
 * One player's private state and its view of the contract. Two deck keys: this deal's, and
 * the one the next deck is being prepared with; they rotate when a deal starts.
 */
export class Seat {
  readonly contract: Contract<PS>;
  x = randomScalar();
  nextX = randomScalar();
  /** The seat the referee gave this player; -1 until joined. */
  index = -1;

  /** `secret` is the player's identity at the table (the seat owner is its curve point); a Live player keeps theirs. */
  constructor(readonly name: string, readonly secret = randomScalar()) {
    this.contract = new Contract<PS>({
      player_secret: (ctx) => [ctx.privateState, secret],
      deck_key: (ctx) => [ctx.privateState, this.x],
      next_deck_key: (ctx) => [ctx.privateState, this.nextX],
      permuted: (ctx) => [ctx.privateState, randomPermutation().map((k) => ctx.ledger.deck[k]!)],
      next_permuted: (ctx) => [ctx.privateState, randomPermutation().map((k) => ctx.ledger.next_deck[k]!)],
      blinding: (ctx) => [ctx.privateState, Array.from({ length: 52 }, randomScalar)],
      best_five: (ctx) => [ctx.privateState, bestFive(ctx.ledger, this.index, this.x)],
      split_share: (ctx) => [ctx.privateState, splits(ctx.ledger).share],
      split_odd: (ctx) => [ctx.privateState, splits(ctx.ledger).odd],
      forfeit_share: (ctx) => [ctx.privateState, forfeitSplit(ctx.ledger).share],
      forfeit_odd: (ctx) => [ctx.privateState, forfeitSplit(ctx.ledger).odd],
      prep_forfeit_share: (ctx) => [ctx.privateState, prepForfeitSplit(ctx.ledger).share],
      prep_forfeit_odd: (ctx) => [ctx.privateState, prepForfeitSplit(ctx.ledger).odd],
    });
  }

  /** A deal started: the prepared key becomes this deal's (or a fresh one), and the next is drawn. */
  rotate(prepared: boolean) {
    this.x = prepared ? this.nextX : randomScalar();
    this.nextX = randomScalar();
  }

  /** Where this player's stack and bond go back to. Practice chips go nowhere real. */
  readonly address = crypto.getRandomValues(new Uint8Array(32));
}

/** What the table says while a phase runs. */
const PHASE_MESSAGE: Record<number, string> = {
  [Phase.keys]: "Dealing",
  [Phase.holes]: "Dealing",
  [Phase.tabling]: "Hands are tabled",
  [Phase.showdown]: "Showdown",
};

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
    if (this.timer) clearTimeout(this.timer); // the auto-fold at the deadline
    this.timer = null;
    await this.perform(this.you, action);
    await this.drive();
  }

  async show() {
    if (!canShow(this.ledger, this.you)) throw new Error("nothing to show");
    await this.call(this.you, "show", BigInt(this.you));
    this.publish();
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

  private async perform(seat: number, action: Action) {
    const { step, note } = actionStep(this.ledger, seat, action);
    await this.call(seat, step.circuit, ...step.args);
    this.lastAction[seat] = note;
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
    const prepared = this.ledger.phase === Phase.holes;
    for (const p of this.players) p.rotate(prepared);
    await this.drive();
  }

  /** Every step any seat owes right now, in seat order; true if there was one. */
  private async runOwed(): Promise<boolean> {
    let did = false;
    for (const seat of this.seats) {
      if (!seat) continue;
      for (const step of owed(this.ledger, seat.index)) {
        const l = this.ledger;
        if (step.circuit === "post_key") seat.x = randomScalar();
        if (step.circuit === "shuffle") this.message = `${this.names[seat.index]} shuffles`;
        else if (step.circuit === "shuffle_next") this.message = `${this.names[seat.index]} shuffles the next deck`;
        else this.message = PHASE_MESSAGE[l.phase] ?? this.message;
        this.publish();
        await this.call(seat.index, step.circuit, ...step.args);
        did = true;
        await new Promise((r) => setTimeout(r, 0)); // let the scene draw between steps
      }
    }
    return did;
  }

  /** Runs every step that needs no decision, until a human's turn, a bot's think time, or the pause between deals. */
  private async drive() {
    if (this.driving || this.stopped) return;
    this.driving = true;
    try {
      for (;;) {
        const l = this.ledger;
        if (l.street !== this.lastStreet) {
          this.lastAction = this.lastAction.map(() => null);
          this.lastStreet = l.street;
        }
        if (l.phase === Phase.playing) {
          // Betting is on: the next deck gets prepared in the background, then someone decides.
          if (await this.runOwed()) continue;
          this.message = "";
          const s = Number(l.to_act);
          this.publish();
          if (s === this.you) {
            // Check-else-fold when the clock (30 s plus the time bank) runs out: the client's
            // convenience, since the contract cannot fold an absent player (ADR 0006).
            const left = Number(l.deadline) - CLOCK_SLACK - Math.floor(Date.now() / 1000);
            this.timer = setTimeout(async () => {
              this.timer = null;
              if (this.stopped || this.ledger.phase !== Phase.playing || Number(this.ledger.to_act) !== this.you) return;
              await this.perform(this.you, legal(this.ledger, this.you).check ? { type: "check" } : { type: "fold" });
              await this.drive();
            }, Math.max(0, left) * 1000);
            return;
          }
          const [lo, hi] = this.botDelay;
          this.timer = setTimeout(async () => {
            this.timer = null;
            if (this.stopped) return;
            await this.perform(s, botAction(legal(this.ledger, s)));
            await this.drive();
          }, lo + Math.random() * (hi - lo));
          return;
        }
        if (l.phase === Phase.done) {
          // Say who won, finish the next deck if it is not ready yet, pause, deal again.
          ({ message: this.message, winners: this.winners } = outcome(l, this.names, this.you, this.stackBefore));
          this.publish();
          while (this.ledger.next_prep === Prep.keys || this.ledger.next_prep === Prep.shuffle) if (!(await this.runOwed())) break;
          this.timer = setTimeout(() => {
            this.timer = null;
            void this.nextDeal();
          }, this.betweenDeals);
          return;
        }
        if (!(await this.runOwed())) {
          this.publish();
          return; // nothing owed and nothing to decide: a phase waits on a deadline only
        }
        this.publish();
      }
    } finally {
      this.driving = false;
    }
  }

  private publish() {
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }

  private snapshot(): TableState {
    if (!this.state) return emptyTable(this.names, this.you);
    return tableFrom(this.ledger, { names: this.names, you: this.you, x: this.seats[this.you]?.x ?? 0n, lastAction: this.lastAction, message: this.message, winners: this.winners });
  }
}
