import { ecMulGenerator } from "@midnight-ntwrk/compact-runtime";
import { cardName, holeCards, openCard, shownCards } from "../../contracts/client.ts";
import type { Ledger } from "../../contracts/build/deal/contract/index.js";
import type { Card } from "../poker/cards.ts";
import { CATEGORIES } from "../poker/hand.ts";
import type { Legal, SeatView, Street, TableState } from "./types.ts";

// What both referees read off the contract's ledger: the phases, who owes which step, what
// a seat may do, and the table as the scene sees it. Pure functions of the ledger; the
// Practice referee runs the steps in memory for every seat, the Live one sends its own
// seat's as transactions and watches the chain for the others'.

export type Circuit =
  | "join" | "buy_in" | "stand_up" | "leave" | "start_deal" | "post_key" | "shuffle" | "post_next_key" | "shuffle_next" | "expire_next"
  | "shares" | "release" | "act" | "act_out" | "show" | "show_hand" | "settle" | "expire" | "settle_abort";
export type Arg = bigint | bigint[] | Uint8Array | boolean;
export type Step = { circuit: Circuit; args: Arg[] };
/** Circuits that do not take the caller's clock. */
export const UNTIMED = new Set<Circuit>(["join", "buy_in", "stand_up", "leave", "expire", "settle", "settle_abort"]);
export const Phase = { idle: 0, keys: 1, shuffle: 2, holes: 3, playing: 4, release: 5, tabling: 6, showdown: 7, done: 8, aborted: 9 };
export const Prep = { none: 0, keys: 1, shuffle: 2, ready: 3 };
export const MIN_BUY_IN = 80;
export const MAX_BUY_IN = 200;
export const BIG_BLIND = 2;
// The contract sets every deadline this much after the stated clock, so that a stale clock
// cannot shorten anyone's time; a client must have acted this much before the contract's
// deadline, which on a live table is the time a transaction needs to land.
export const CLOCK_SLACK = 20;
export const NONE = 255n;
const STREETS: Street[] = ["preflop", "flop", "turn", "river"];
const BOARD_LEN = [0, 3, 4, 5];

export const seatsOf = (l: Ledger) => [0, 1, 2, 3, 4, 5].filter((i) => l.in_deal[i]);
/** Ten positions for the `shares` circuit: fewer are padded by repeating the last one. */
export const ten = (positions: number[]): bigint[] => Array.from({ length: 10 }, (_, i) => BigInt(positions[Math.min(i, positions.length - 1)]!));
/** Seats with a player in them. */
export const occupied = (l: Ledger) => [0, 1, 2, 3, 4, 5].filter((i) => l.seat_owner.member(BigInt(i)));

/** The seat held by the player with this secret (the owner's point is the secret times the generator), or -1. */
export function seatOf(l: Ledger, secret: bigint): number {
  const me = ecMulGenerator(secret);
  return occupied(l).find((i) => {
    const p = l.seat_owner.lookup(BigInt(i));
    return p.x === me.x && p.y === me.y;
  }) ?? -1;
}

/** The contract's betting rules for a seat, for the rail and the bots. */
export function legal(l: Ledger, seat: number): Legal {
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

/** Once the deal is over, a player dealt in may open their cards, once. */
export function canShow(l: Ledger, seat: number): boolean {
  const over = l.phase === Phase.showdown || l.phase === Phase.done || l.phase === Phase.aborted;
  return over && !!l.in_deal[seat] && shownCards(l, seat) === null;
}

/**
 * The mechanical steps a seat owes right now, none of them a decision: its key, its shuffle,
 * its shares and releases, tabling and proving its hand, settling (by the first seat still in,
 * or the first in the deal for an abort), and its part in preparing the next deck.
 */
export function owed(l: Ledger, seat: number): Step[] {
  const steps: Step[] = [];
  const s = BigInt(seat);
  const inDeal = seatsOf(l);
  const live = inDeal.filter((i) => !l.folded[i]);
  switch (l.phase) {
    case Phase.keys:
      if (l.in_deal[seat] && !l.keys.member(s)) steps.push({ circuit: "post_key", args: [s] });
      break;
    case Phase.shuffle:
      if (Number(l.turn) === seat) steps.push({ circuit: "shuffle", args: [s] });
      break;
    case Phase.holes: {
      // Positions go by dealing order, not seat number.
      const need = BigInt(inDeal.length * 2 - 2);
      if (l.in_deal[seat] && !(l.hole_shares.member(s) && l.hole_shares.lookup(s) >= need)) {
        const others = inDeal.filter((i) => i !== seat).flatMap((i) => [2 * inDeal.indexOf(i), 2 * inDeal.indexOf(i) + 1]);
        steps.push({ circuit: "shares", args: [s, ten(others)] });
      }
      break;
    }
    case Phase.release: {
      const need = BigInt(BOARD_LEN[Number(l.release_street)]!);
      if (live.includes(seat) && !(l.board_shares.member(s) && l.board_shares.lookup(s) >= need)) steps.push({ circuit: "release", args: [s] });
      break;
    }
    case Phase.tabling:
      if (live.includes(seat) && shownCards(l, seat) === null) steps.push({ circuit: "show", args: [s] });
      break;
    case Phase.showdown:
      if (live.includes(seat) && !l.scores.member(s)) steps.push({ circuit: "show_hand", args: [s] });
      else if (seat === live[0] && live.every((i) => l.scores.member(BigInt(i)))) steps.push({ circuit: "settle", args: [] });
      break;
    case Phase.aborted:
      if (seat === occupied(l)[0]) steps.push({ circuit: "settle_abort", args: [] });
      break;
  }
  // The next deck, prepared alongside the deal, once this deal is under way.
  if (l.phase >= Phase.playing) {
    if (l.next_prep === Prep.keys && l.next_in_deal[seat] && !l.next_has_key[seat]) steps.push({ circuit: "post_next_key", args: [s] });
    if (l.next_prep === Prep.shuffle && Number(l.next_turn) === seat) steps.push({ circuit: "shuffle_next", args: [s] });
  }
  return steps;
}

/** A betting action as the circuit it is: leaving chips behind (act_out) or not (act). */
export function actionStep(l: Ledger, seat: number, action: { type: "fold" } | { type: "check" } | { type: "call" } | { type: "raise"; to: number }): { step: Step; note: string } {
  const [FOLD, CHECK, CALL, RAISE] = [0n, 0n, 1n, 2n];
  const s = BigInt(seat);
  const rules = legal(l, seat);
  const stack = Number(l.stack[seat]);
  const bet = Number(l.bet[seat]);
  switch (action.type) {
    case "fold":
      return { step: { circuit: "act_out", args: [s, FOLD, 0n] }, note: "fold" };
    case "check":
      return { step: { circuit: "act", args: [s, CHECK, 0n] }, note: "check" };
    case "call":
      return { step: { circuit: rules.call >= stack ? "act_out" : "act", args: [s, CALL, 0n] }, note: `call ${rules.call}` };
    case "raise":
      return {
        step: { circuit: action.to - bet >= stack ? "act_out" : "act", args: [s, RAISE, BigInt(action.to)] },
        note: `${Number(l.current_bet) === 0 ? "bet" : "raise to"} ${action.to}`,
      };
  }
}

/** Who won what, once a deal is done, from the stacks before it and the pot. */
export function outcome(l: Ledger, names: (string | null)[], you: number, stackBefore: number[]): { message: string; winners: number[] } {
  if (Number(l.offender) !== 255) return { message: `Deal aborted: ${names[Number(l.offender)] ?? "someone"} did not act in time and leaves the table`, winners: [] };
  const payouts = l.stack.map((s, i) => Number(s) - (stackBefore[i] ?? 0) + Number(l.total[i]));
  const winners = payouts.map((p, i) => (p > 0 ? i : -1)).filter((i) => i >= 0);
  const message = winners
    .map((w) => {
      const who = w === you ? "You" : names[w];
      const how = l.scores.member(BigInt(w)) ? ` with ${CATEGORIES[Number(l.scores.lookup(BigInt(w)) / 15n ** 5n)]}` : "";
      return `${who} win${w === you ? "" : "s"} ${payouts[w]}${how}`;
    })
    .join(", ");
  return { message, winners };
}

export type View = {
  names: (string | null)[];
  you: number;
  /** Your deck key for this deal: your hole cards are read with it. */
  x: bigint;
  lastAction: (string | null)[];
  message: string;
  winners: number[];
};

/** The table before anything has happened: the seats are known, nothing else. */
export function emptyTable(names: (string | null)[], you: number): TableState {
  return {
    seats: names.map((name) => ({ name, stack: 0, bet: 0, inHand: false, folded: false, allIn: false, hole: null, lastAction: null, isWinner: false })),
    dealer: -1,
    street: "between",
    board: [],
    pot: 0,
    toAct: null,
    you,
    legal: null,
    bigBlind: BIG_BLIND,
    message: "",
    canShow: false,
    deadline: null,
    timeBank: 0,
  };
}

/** The table as the scene sees it: everything a player may know, never another seat's hole cards before they show. */
export function tableFrom(l: Ledger, v: View): TableState {
  const phase = l.phase;
  // A finished deal stays on the table (cards, bets, the winner) until the next one starts.
  const inDeal = phase >= Phase.keys;
  const betting = phase >= Phase.playing && phase <= Phase.showdown;
  let mine: Card[] | null = null;
  if (betting || phase === Phase.done) {
    try {
      mine = holeCards(l, v.you, v.x).map(cardName);
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
  const seats: SeatView[] = v.names.map((name, i) => ({
    name,
    stack: Number(l.stack[i]),
    bet: inDeal ? Number(l.bet[i]) : 0,
    // A shown hand stays face up on the felt, folded or not.
    inHand: inDeal && l.in_deal[i]! && (!l.folded[i]! || shown(i) !== null),
    folded: inDeal && l.folded[i]!,
    allIn: inDeal && l.all_in[i]!,
    hole: i === v.you ? (l.in_deal[i] ? mine : null) : shown(i),
    lastAction: v.lastAction[i] ?? null,
    isWinner: v.winners.includes(i),
  }));
  return {
    seats,
    dealer: Number(l.dealer) === 255 ? -1 : Number(l.dealer),
    street: phase === Phase.showdown ? "showdown" : phase === Phase.playing || phase === Phase.release || phase === Phase.tabling ? STREETS[Number(l.street)]! : "between",
    board,
    pot: l.total.reduce((a, b) => a + Number(b), 0),
    toAct: phase === Phase.playing && l.to_act !== NONE ? Number(l.to_act) : null,
    you: v.you,
    legal: phase === Phase.playing && Number(l.to_act) === v.you ? legal(l, v.you) : null,
    bigBlind: BIG_BLIND,
    message: v.message,
    canShow: v.you >= 0 && canShow(l, v.you),
    deadline: phase === Phase.playing && l.deadline !== 0n ? Number(l.deadline) - CLOCK_SLACK : null,
    timeBank: v.you >= 0 ? Number(l.bank[v.you]) : 0,
  };
}
