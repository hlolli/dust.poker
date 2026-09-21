import { ContractState as RuntimeContractState } from "@midnight-ntwrk/compact-runtime";
import { ledger, type Ledger } from "../../contracts/build/deal/contract/index.js";
import type { Seat } from "../referee/contract.ts";
import { actionStep, canShow, CLOCK_SLACK, emptyTable, legal, occupied, outcome, owed, Phase, type Step, tableFrom } from "../referee/rules.ts";
import type { Action, Referee, TableState } from "../referee/types.ts";
import { type Chain, callOn, type Snapshot } from "./chain.ts";

// The Live referee: the same contract as the Practice table, but on the chain. It watches the
// referee's state through the chain, performs the steps its own seat owes as transactions
// (keys, shuffles, shares, releases, showing, proving the hand, settling, and its part of the
// next deck), and takes betting decisions from the player. Every other seat is another
// player's client doing the same; nothing here ever acts for them (ADR 0001).

export interface LiveOptions {
  /** How often to ask the chain, in ms. */
  poll?: number;
  /** How long to wait after a deal ends before the lowest seat starts the next, in ms. */
  betweenDeals?: number;
  /** After this long without the chain moving, a submitted step is tried again, in ms. */
  retry?: number;
}

export class LiveReferee implements Referee {
  private readonly names: (string | null)[] = [null, null, null, null, null, null];
  private snap: Snapshot | null = null;
  private l: Ledger | null = null;
  private seen = "";
  private lastDeal = -1n;
  private lastStreet = -1n;
  private lastAction: (string | null)[] = [null, null, null, null, null, null];
  private message = "";
  private winners: number[] = [];
  private stackBefore: number[] = [];
  private doneSince = 0;
  /** A step sent and not yet seen on the chain, and when it was sent. */
  private pending: { step: Step; at: number } | null = null;
  private listeners = new Set<(s: TableState) => void>();
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private readonly poll: number;
  private readonly betweenDeals: number;
  private readonly retry: number;

  constructor(
    private readonly chain: Chain,
    private readonly seat: Seat,
    o: LiveOptions = {},
  ) {
    this.poll = o.poll ?? 3000;
    this.betweenDeals = o.betweenDeals ?? 6000;
    this.retry = o.retry ?? 90_000;
  }

  get you() {
    return this.seat.index;
  }

  start() {
    this.stopped = false;
    void this.tick();
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
    const l = this.l;
    if (!l || l.phase !== Phase.playing || Number(l.to_act) !== this.you) throw new Error("not your turn");
    const { step, note } = actionStep(l, this.you, action);
    this.lastAction[this.you] = note;
    await this.send(step);
  }

  async show() {
    if (!this.l || !canShow(this.l, this.you)) throw new Error("nothing to show");
    await this.send({ circuit: "show", args: [BigInt(this.you)] });
  }

  /** One transaction: the circuit run against the last snapshot, proven and submitted through the chain. */
  private async send(step: Step) {
    if (!this.snap) throw new Error("the chain has not answered yet");
    this.pending = { step, at: Date.now() };
    this.publish();
    try {
      const { tx } = await callOn(this.chain, this.snap, this.seat, step.circuit, step.args);
      await this.chain.submit(tx);
    } catch (e) {
      this.pending = null;
      throw e;
    }
  }

  /** Reads the chain; on a change, updates the view; then does what the seat owes. */
  private async tick() {
    if (this.stopped) return;
    if (!this.busy) {
      this.busy = true;
      try {
        await this.read();
        await this.step();
      } catch (e) {
        this.message = e instanceof Error ? e.message : String(e);
        this.publish();
      } finally {
        this.busy = false;
      }
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.tick(), this.pending ? Math.min(this.poll, 1000) : this.poll);
  }

  private async read() {
    const snap = await this.chain.snapshot();
    this.snap = snap;
    if (!snap.state) return;
    const raw = snap.state.serialize();
    const key = String(raw.length) + ":" + Array.from(raw.subarray(0, 64)).join(",") + ":" + Array.from(raw.subarray(-64)).join(",");
    const state = RuntimeContractState.deserialize(raw);
    const l = ledger(state.data);
    const changed = key !== this.seen || this.l === null;
    this.seen = key;
    this.l = l;
    if (!changed) return;
    this.pending = null; // the chain moved: whatever was sent is either in or overtaken
    for (const i of occupied(l)) this.names[i] ??= i === this.you ? this.seat.name : `Seat ${i + 1}`;
    if (l.deal_no !== this.lastDeal) {
      // A deal started since we last looked: keys rotate (prepared if it opened at the hole
      // cards), stacks before the blinds are stack plus what is in so far.
      this.lastDeal = l.deal_no;
      if (l.phase >= Phase.keys && l.phase !== Phase.idle) this.seat.rotate(l.phase !== Phase.keys && l.phase !== Phase.shuffle);
      this.stackBefore = l.stack.map((s, i) => Number(s) + Number(l.total[i]));
      this.lastAction = this.lastAction.map(() => null);
      this.winners = [];
      this.message = "";
      this.doneSince = 0;
    }
    if (l.street !== this.lastStreet) {
      this.lastAction = this.lastAction.map(() => null);
      this.lastStreet = l.street;
    }
    if (l.phase === Phase.done && !this.doneSince) {
      ({ message: this.message, winners: this.winners } = outcome(l, this.names, this.you, this.stackBefore));
      this.doneSince = Date.now();
    } else if (l.phase === Phase.aborted) this.message = "Deal aborted";
    else if (l.phase === Phase.shuffle) this.message = `${this.names[Number(l.turn)]} shuffles`;
    else if (l.phase < Phase.playing) this.message = "Dealing";
    else if (l.phase === Phase.tabling) this.message = "Hands are tabled";
    else if (l.phase === Phase.showdown) this.message = "Showdown";
    else if (l.phase === Phase.playing) this.message = "";
    this.publish();
  }

  private async step() {
    const l = this.l;
    if (!l || !this.snap) return;
    if (this.pending) {
      if (Date.now() - this.pending.at < this.retry) return; // wait for the chain to show it
      this.pending = null;
    }
    const [step] = owed(l, this.you);
    if (step) return void (await this.send(step));
    // Between deals: the lowest seat with chips starts the next one, after a pause.
    const starter = occupied(l).find((i) => l.stack[i]! > 0n);
    const over = l.phase === Phase.idle || l.phase === Phase.done;
    if (over && starter === this.you && occupied(l).filter((i) => l.stack[i]! > 0n).length >= 2) {
      if (l.phase === Phase.idle || Date.now() - this.doneSince >= this.betweenDeals) await this.send({ circuit: "start_deal", args: [] });
    }
  }

  private publish() {
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }

  private snapshot(): TableState {
    if (!this.l) return { ...emptyTable(this.names, this.you), message: this.message || "Reading the table" };
    const table = tableFrom(this.l, { names: this.names, you: this.you, x: this.seat.x, lastAction: this.lastAction, message: this.message, winners: this.winners });
    // While a step of ours is on its way, the rail waits; the clock is the contract's.
    if (this.pending) return { ...table, legal: null, canShow: false, message: this.message || "Sending" };
    return table;
  }
}

/** Seconds a client should keep for a transaction to land, relative to the contract's deadline. */
export const LANDING = CLOCK_SLACK;
