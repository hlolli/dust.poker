import { ContractState as RuntimeContractState } from "@midnight-ntwrk/compact-runtime";
import { ChargedState, ContractState } from "@midnightntwrk/ledger-v9";
import { ledger, type Ledger } from "../../contracts/build/deal/contract/index.js";
import type { Seat } from "../referee/contract.ts";
import { actionStep, canShow, CLOCK_SLACK, emptyTable, legal, occupied, outcome, owed, Phase, Prep, seatOf, type Step, tableFrom } from "../referee/rules.ts";
import type { Action, Referee, TableState } from "../referee/types.ts";
import { type Chain, callOn, type Snapshot } from "./chain.ts";

// The Live referee: the same contract as the Practice table, but on the chain. It watches the
// referee's state through the chain, performs the steps its own seat owes as transactions
// (keys, shuffles, shares, releases, showing, proving the hand, settling, and its part of the
// next deck), and takes betting decisions from the player. Every other seat is another
// player's client doing the same; nothing here ever acts for them (ADR 0001).

/** Where a seat's deck keys are kept between page loads, so a reload mid-deal loses nothing. */
export interface KeyStore {
  load(): { dealNo: bigint; x: bigint; nextX: bigint } | null;
  save(keys: { dealNo: bigint; x: bigint; nextX: bigint }): void;
}

export interface LiveOptions {
  /** The deck keys' keeping place; without one they live as long as the page. */
  store?: KeyStore;
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
  private seen: Uint8Array | null = null;
  private revision = 0;
  private lastDeal = -1n;
  private lastStreet = -1n;
  private lastAction: (string | null)[] = [null, null, null, null, null, null];
  private message = "";
  private winners: number[] = [];
  private stackBefore: number[] = [];
  private doneSince = 0;
  /** A step sent and not yet seen on the chain, and when it was sent. */
  private pending: { step: Step; at: number } | null = null;
  /** The last step sent, by what it was for, and when: the same step is not sent again within `retry`. */
  private lastSent: { key: string; at: number } | null = null;
  private listeners = new Set<(s: TableState) => void>();
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private unwatch: (() => void) | null = null;
  /** A snapshot the chain pushed while a tick was busy, to be taken up by the next. */
  private pushed: Snapshot | null = null;
  private readonly poll: number;
  private readonly betweenDeals: number;
  private readonly retry: number;
  private readonly store: KeyStore | null;

  constructor(
    private readonly chain: Chain,
    private readonly seat: Seat,
    o: LiveOptions = {},
  ) {
    // A chain that pushes changes is polled only as a safety net.
    this.poll = o.poll ?? (chain.watch ? 20_000 : 3000);
    this.betweenDeals = o.betweenDeals ?? 6000;
    this.retry = o.retry ?? 90_000;
    this.store = o.store ?? null;
  }

  get you() {
    return this.seat.index;
  }

  start() {
    this.stopped = false;
    this.unwatch = this.chain.watch?.((snap) => {
      this.pushed = snap;
      void this.tick(snap);
    }) ?? null;
    void this.tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unwatch?.();
    this.unwatch = null;
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
    const key = this.situation(step);
    this.pending = { step, at: Date.now() };
    this.publish();
    try {
      const { tx } = await callOn(this.chain, this.snap, this.seat, step.circuit, step.args);
      await this.chain.submit(tx);
      this.lastSent = { key, at: Date.now() }; // accepted by the chain; a refusal is retried at once
    } catch (e) {
      this.pending = null;
      throw e;
    }
  }

  /** Takes in the chain's state, pushed or asked for; on a change, updates the view; then does what the seat owes. */
  private async tick(pushed?: Snapshot) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    if (!this.busy) {
      this.busy = true;
      try {
        do {
          const snap = this.pushed ?? pushed ?? (await this.chain.snapshot());
          this.pushed = null;
          this.read(snap);
          await this.step();
        } while (this.pushed && !this.stopped); // a push landed meanwhile
      } catch (e) {
        this.message = reason(e);
        this.publish();
      } finally {
        this.busy = false;
      }
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.tick(), this.pending ? Math.min(this.poll, 1000) : this.poll);
  }

  private read(snap: Snapshot) {
    this.snap = snap;
    if (!snap.state) return;
    const state = RuntimeContractState.deserialize(snap.state.serialize());
    // Ledger bookkeeping can change after a failed call. Only changed contract data
    // makes a stale transcript worth rebuilding before the normal retry interval.
    const data = new ContractState();
    data.data = new ChargedState(snap.state.data.state);
    const raw = data.serialize();
    const changed = !this.seen || raw.length !== this.seen.length || raw.some((b, i) => b !== this.seen![i]);
    const l = ledger(state.data);
    this.l = l;
    if (!changed) return;
    this.seen = raw;
    this.revision++;
    this.pending = null; // the chain moved: whatever was sent is either in or overtaken
    for (let i = 0; i < this.names.length; i++) this.names[i] = l.seat_owner.member(BigInt(i)) ? (i === this.you ? this.seat.name : `Seat ${i + 1}`) : null;
    if (l.deal_no !== this.lastDeal) {
      // A deal started since we last looked: keys rotate (prepared if it opened at the hole
      // cards), stacks before the blinds are stack plus what is in so far. On the first look
      // after a reload, the keys come back from the store: this deal's as they were, or the
      // next deck's carried into a deal that began while we were away.
      const prepared = l.phase !== Phase.keys && l.phase !== Phase.shuffle;
      const kept = this.lastDeal === -1n ? this.store?.load() : null;
      if (kept && kept.dealNo === l.deal_no) {
        this.seat.x = kept.x;
        this.seat.nextX = kept.nextX;
      } else if (l.phase >= Phase.keys && l.phase !== Phase.idle) {
        if (kept && kept.dealNo + 1n === l.deal_no) this.seat.nextX = kept.nextX;
        this.seat.rotate(prepared);
      }
      this.lastDeal = l.deal_no;
      this.store?.save({ dealNo: l.deal_no, x: this.seat.x, nextX: this.seat.nextX });
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
    if (seatOf(l, this.seat.secret) !== this.you) return; // this seat may have been evicted or taken again
    const [step] = owed(l, this.you);
    // Once the last hand is proved, no player owes anything that could time out.
    if (step?.circuit === "settle" || step?.circuit === "settle_abort") return void (await this.sendOnce(step));
    // Recovery is permissionless. Use the observed block time for expiry, so a fast local
    // clock cannot forfeit another player before the contract's deadline.
    const over = l.phase === Phase.idle || l.phase === Phase.done;
    if (l.phase >= Phase.keys && l.phase <= Phase.showdown && l.deadline !== 0n && BigInt(this.snap.time) >= l.deadline) {
      return void (await this.sendOnce({ circuit: "expire", args: [] }));
    }
    if (over && (l.next_prep === Prep.keys || l.next_prep === Prep.shuffle) && BigInt(this.snap.time) >= l.next_deadline) {
      return void (await this.sendOnce({ circuit: "expire_next", args: [] }));
    }
    // Leave enough of the contract's slack for the check/fold to prove and land.
    if (l.phase === Phase.playing && Number(l.to_act) === this.you && Date.now() / 1000 >= Number(l.deadline) - CLOCK_SLACK) {
      const { step, note } = actionStep(l, this.you, legal(l, this.you).check ? { type: "check" } : { type: "fold" });
      this.lastAction[this.you] = note;
      return void (await this.sendOnce(step));
    }
    if (step) return void (await this.sendOnce(step));
    // Between deals: the lowest seat with chips starts the next one, after a pause.
    const playing = occupied(l).filter((i) => l.stack[i]! > 0n && !l.leaving[i]);
    const starter = playing[0];
    if (over && starter === this.you && playing.length >= 2) {
      if (l.phase === Phase.idle || Date.now() - this.doneSince >= this.betweenDeals) await this.sendOnce({ circuit: "start_deal", args: [] });
    }
  }

  /**
   * Sends a step the seat owes, unless the same step for the same situation went out within
   * `retry`: a step that lands but fails on the chain (its section reverted, its fee paid)
   * leaves the situation as it was, and every push would otherwise send it again at once.
   */
  private async sendOnce(step: Step) {
    if (this.lastSent && this.lastSent.key === this.situation(step) && Date.now() - this.lastSent.at < this.retry) return;
    await this.send(step);
  }

  /** A failed fallible call can be retried as soon as another player changes its inputs. */
  private situation(step: Step): string {
    return `${this.revision}:${step.circuit}:${step.args.map(String).join(",")}`;
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

/** An error's message with its causes: a wallet wraps the node's answer two or three layers deep. */
export function reason(e: unknown): string {
  const parts: string[] = [];
  for (let at = e, depth = 0; at && depth < 6; at = (at as { cause?: unknown }).cause, depth++) {
    const m = at instanceof Error ? at.message : String(at);
    if (!parts.includes(m)) parts.push(m);
  }
  return parts.join(": ") || String(e);
}
