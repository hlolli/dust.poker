import { botAction } from "../poker/bot.ts";
import { deck, shuffle } from "../poker/cards.ts";
import { type Action, applyAction, type Deal, legalActions, startDeal } from "../poker/deal.ts";
import type { Referee, SeatView, TableState } from "./types.ts";

export interface PracticeOptions {
  /** null for an empty seat. */
  names: (string | null)[];
  you: number;
  bigBlind?: number;
  /** Everyone sits down with this and tops up to it between deals. */
  buyIn?: number;
  /** Bot think time and pause between deals, in ms. */
  botDelay?: [number, number];
  betweenDeals?: number;
}

/** The referee for a Practice table: runs in this browser, bots in the other seats. */
export class PracticeReferee implements Referee {
  private readonly names: (string | null)[];
  private readonly you: number;
  private readonly bigBlind: number;
  private readonly buyIn: number;
  private readonly botDelay: [number, number];
  private readonly betweenDeals: number;
  private stacks: (number | null)[];
  private dealer = -1;
  private deal: Deal | null = null;
  private lastAction: (string | null)[];
  private message = "";
  private listeners = new Set<(s: TableState) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(o: PracticeOptions) {
    this.names = o.names;
    this.you = o.you;
    this.bigBlind = o.bigBlind ?? 2;
    this.buyIn = o.buyIn ?? this.bigBlind * 100;
    this.botDelay = o.botDelay ?? [700, 1600];
    this.betweenDeals = o.betweenDeals ?? 4000;
    this.stacks = o.names.map((n) => (n === null ? null : this.buyIn));
    this.lastAction = o.names.map(() => null);
  }

  start() {
    this.nextDeal();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  subscribe(fn: (s: TableState) => void) {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => void this.listeners.delete(fn);
  }

  async act(action: Action) {
    if (!this.deal || this.deal.toAct !== this.you) throw new Error("not your turn");
    this.apply(this.you, action);
  }

  private apply(seat: number, action: Action) {
    const d = this.deal!;
    const legal = legalActions(d, seat);
    this.deal = applyAction(d, seat, action);
    this.lastAction[seat] =
      action.type === "raise"
        ? `${d.currentBet === 0 ? "bet" : "raise to"} ${action.to}`
        : action.type === "call"
          ? `call ${legal.call}`
          : action.type;
    if (this.deal.street !== d.street) this.lastAction = this.lastAction.map(() => null);
    if (this.deal.result) this.finishDeal();
    this.publish();
    this.scheduleNext();
  }

  private finishDeal() {
    const d = this.deal!;
    const r = d.result!;
    this.stacks = d.seats.map((s, i) => (s ? s.stack : (this.stacks[i] ?? null)));
    this.message = r.winners
      .map((w) => {
        const who = w === this.you ? "You" : this.names[w];
        const how = r.showdown ? ` with ${r.ranks[w]!.category}` : "";
        return `${who} win${w === this.you ? "" : "s"} ${r.payouts[w]}${how}`;
      })
      .join(", ");
  }

  private nextDeal() {
    // Practice chips are free, but results should still show: a seat tops back up
    // to the buy-in only once it drops under the 40 BB minimum buy-in.
    const minBuyIn = this.bigBlind * 40;
    this.stacks = this.stacks.map((s) => (s === null ? null : s < minBuyIn ? this.buyIn : s));
    const n = this.stacks.length;
    for (let k = 1; k <= n; k++) {
      const i = (this.dealer + k) % n;
      if (this.stacks[i] !== null) {
        this.dealer = i;
        break;
      }
    }
    this.lastAction = this.lastAction.map(() => null);
    this.message = "";
    this.deal = startDeal(this.stacks, this.dealer, this.bigBlind, shuffle(deck()));
    if (this.deal.result) this.finishDeal();
    this.publish();
    this.scheduleNext();
  }

  private scheduleNext() {
    this.stop();
    const d = this.deal!;
    if (d.result) {
      this.timer = setTimeout(() => this.nextDeal(), this.betweenDeals);
    } else if (d.toAct !== null && d.toAct !== this.you) {
      const [lo, hi] = this.botDelay;
      this.timer = setTimeout(() => this.apply(d.toAct!, botAction(legalActions(d, d.toAct!))), lo + Math.random() * (hi - lo));
    }
  }

  private publish() {
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }

  private snapshot(): TableState {
    const d = this.deal;
    const showdown = !!d?.result?.showdown;
    const seats: SeatView[] = this.names.map((name, i) => {
      const s = d?.seats[i] ?? null;
      const revealed = i === this.you || (showdown && s && !s.folded);
      return {
        name,
        stack: s ? s.stack : (this.stacks[i] ?? 0),
        bet: s?.bet ?? 0,
        inHand: !!s && !s.folded,
        folded: s?.folded ?? false,
        allIn: s?.allIn ?? false,
        hole: s && revealed ? [...s.hole] : null,
        lastAction: this.lastAction[i] ?? null,
        isWinner: d?.result?.winners.includes(i) ?? false,
      };
    });
    return {
      seats,
      dealer: this.dealer,
      street: !d ? "between" : d.result ? (d.result.showdown ? "showdown" : "between") : d.street,
      board: d ? [...d.board] : [],
      pot: d ? d.seats.reduce((a, s) => a + (s?.total ?? 0), 0) : 0,
      toAct: d?.toAct ?? null,
      you: this.you,
      legal: d && d.toAct === this.you ? legalActions(d, this.you) : null,
      bigBlind: this.bigBlind,
      message: this.message,
    };
  }
}
