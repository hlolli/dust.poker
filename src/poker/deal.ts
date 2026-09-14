import type { Card } from "./cards.ts";
import { evaluate, type HandRank } from "./hand.ts";
import { settle } from "./payout.ts";

// ponytail: this state machine is the part ADR 0003 hands to Compact later. Keep it
// pure and boring so the port is mechanical; hand.ts, payout.ts and bot.ts stay in TS.

export type Street = "preflop" | "flop" | "turn" | "river";

export type Action = { type: "fold" } | { type: "check" } | { type: "call" } | { type: "raise"; to: number };

export interface Legal {
  check: boolean;
  /** Chips needed to call; 0 when checking is legal. */
  call: number;
  /** Raise "to" amounts for this street, all-in included; null when no raise is possible. */
  raise: { min: number; max: number } | null;
}

export interface DealSeat {
  stack: number;
  /** Committed this street. */
  bet: number;
  /** Committed this deal. */
  total: number;
  folded: boolean;
  allIn: boolean;
  hole: [Card, Card];
  /** Has acted since the last full raise this street. */
  acted: boolean;
}

export interface Result {
  payouts: number[];
  showdown: boolean;
  winners: number[];
  ranks: (HandRank | null)[];
}

export interface Deal {
  seats: (DealSeat | null)[];
  dealer: number;
  bigBlind: number;
  street: Street;
  board: Card[];
  deck: Card[];
  toAct: number | null;
  currentBet: number;
  /** Size of the last full raise; the next raise must be at least this much more. */
  minRaise: number;
  result: Result | null;
}

const STREETS: Street[] = ["preflop", "flop", "turn", "river"];

function nextIndex(d: Deal, from: number, ok: (s: DealSeat) => boolean): number | null {
  const n = d.seats.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const s = d.seats[i];
    if (s && ok(s)) return i;
  }
  return null;
}
const canAct = (s: DealSeat) => !s.folded && !s.allIn;
const inHand = (s: DealSeat) => !s.folded;
const nextActor = (d: Deal, from: number) => nextIndex(d, from, canAct);

function commit(s: DealSeat, amount: number) {
  const a = Math.min(amount, s.stack);
  s.stack -= a;
  s.bet += a;
  s.total += a;
  if (s.stack === 0) s.allIn = true;
}

/** `stacks[i]` is null for an empty seat. Needs two or more seats with chips. */
export function startDeal(stacks: (number | null)[], dealer: number, bigBlind: number, deck: Card[]): Deal {
  const d: Deal = {
    seats: stacks.map(() => null),
    dealer,
    bigBlind,
    street: "preflop",
    board: [],
    deck: [...deck],
    toAct: null,
    currentBet: 0,
    minRaise: bigBlind,
    result: null,
  };
  const players = stacks.map((s, i) => (s && s > 0 ? i : -1)).filter((i) => i >= 0);
  if (players.length < 2) throw new Error("startDeal: need at least two players");
  for (const i of players) {
    d.seats[i] = { stack: stacks[i]!, bet: 0, total: 0, folded: false, allIn: false, hole: ["2c", "2c"], acted: false };
  }
  // Deal one card at a time clockwise from the dealer's left, like a real table.
  const order: number[] = [];
  let i = dealer;
  while (order.length < players.length) {
    i = nextIndex(d, i, () => true)!;
    order.push(i);
  }
  const first = order.map(() => d.deck.shift()!);
  const second = order.map(() => d.deck.shift()!);
  order.forEach((seat, k) => (d.seats[seat]!.hole = [first[k]!, second[k]!]));

  const headsUp = players.length === 2;
  const sb = headsUp ? nextIndex(d, dealer - 1, () => true)! : nextIndex(d, dealer, () => true)!;
  const bb = nextIndex(d, sb, () => true)!;
  commit(d.seats[sb]!, Math.floor(bigBlind / 2));
  commit(d.seats[bb]!, bigBlind);
  d.currentBet = bigBlind;
  d.toAct = nextActor(d, bb);
  return settleIfClosed(d);
}

export function legalActions(d: Deal, seat: number): Legal {
  const s = d.seats[seat];
  if (!s || d.toAct !== seat) return { check: false, call: 0, raise: null };
  const toCall = d.currentBet - s.bet;
  const call = Math.min(toCall, s.stack);
  const othersCanRespond = d.seats.some((o, i) => o && i !== seat && canAct(o));
  // No raise once you have acted since the last full raise: a short all-in
  // behind you may be called or folded to, not re-raised.
  let raise: Legal["raise"] = null;
  if (s.stack > toCall && othersCanRespond && !s.acted) {
    const max = s.bet + s.stack;
    const min = Math.min(max, d.currentBet === 0 ? d.bigBlind : d.currentBet + d.minRaise);
    raise = { min, max };
  }
  return { check: toCall === 0, call: toCall === 0 ? 0 : call, raise };
}

/** Returns a new Deal; throws on an illegal action. */
export function applyAction(d0: Deal, seat: number, action: Action): Deal {
  const d = clone(d0);
  const legal = legalActions(d, seat);
  const s = d.seats[seat];
  if (!s || d.toAct !== seat) throw new Error(`seat ${seat} is not to act`);

  switch (action.type) {
    case "fold":
      s.folded = true;
      break;
    case "check":
      if (!legal.check) throw new Error("check is not legal, there is a bet to call");
      break;
    case "call":
      if (legal.call === 0) throw new Error("nothing to call");
      commit(s, legal.call);
      break;
    case "raise": {
      if (!legal.raise) throw new Error("raise is not legal");
      const { min, max } = legal.raise;
      if (action.to > max || (action.to < min && action.to !== max)) throw new Error(`raise to ${action.to} outside ${min}-${max}`);
      const increment = action.to - d.currentBet;
      commit(s, action.to - s.bet);
      if (increment >= d.minRaise) {
        // A full raise reopens the action for everyone else.
        d.minRaise = increment;
        for (const o of d.seats) if (o && o !== s) o.acted = false;
      }
      d.currentBet = action.to;
      break;
    }
  }
  s.acted = true;
  d.toAct = nextActor(d, seat);
  return settleIfClosed(d);
}

function settleIfClosed(d: Deal): Deal {
  const live = d.seats.filter((s): s is DealSeat => !!s && inHand(s));
  if (live.length === 1) return finish(d, false);

  const actors = live.filter(canAct);
  const roundOpen = actors.some((s) => !s.acted || s.bet !== d.currentBet);
  if (roundOpen && actors.length > 0) {
    // Someone still owes an action. Make sure toAct points at one of them.
    if (d.toAct === null || !canAct(d.seats[d.toAct]!)) d.toAct = nextActor(d, d.toAct ?? d.dealer);
    return d;
  }

  // Street closed. Next street, or run out the board when betting is over for good.
  const bettingOver = actors.length <= 1;
  do {
    if (d.street === "river") return finish(d, true);
    d.street = STREETS[STREETS.indexOf(d.street) + 1]!;
    d.board.push(...d.deck.splice(0, d.street === "flop" ? 3 : 1));
    for (const s of d.seats) if (s) (s.bet = 0), (s.acted = false);
    d.currentBet = 0;
    d.minRaise = d.bigBlind;
    d.toAct = bettingOver ? null : nextActor(d, d.dealer);
  } while (bettingOver);
  return d;
}

function finish(d: Deal, showdown: boolean): Deal {
  const ranks = d.seats.map((s) => (s && inHand(s) && showdown ? evaluate([...s.hole, ...d.board]) : null));
  const payouts = settle(
    d.seats.map((s, i) => (s ? { total: s.total, folded: s.folded, score: ranks[i]?.score ?? 0 } : null)),
    d.dealer,
  );
  d.seats.forEach((s, i) => s && (s.stack += payouts[i]!));
  d.result = { payouts, showdown, winners: payouts.map((p, i) => (p > 0 ? i : -1)).filter((i) => i >= 0), ranks };
  d.toAct = null;
  return d;
}

function clone(d: Deal): Deal {
  return {
    ...d,
    seats: d.seats.map((s) => (s ? { ...s, hole: [...s.hole] as [Card, Card] } : null)),
    board: [...d.board],
    deck: [...d.deck],
    result: null,
  };
}
