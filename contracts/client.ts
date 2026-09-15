import { ecAdd, ecMul, ecNeg, type JubjubPoint } from "@midnight-ntwrk/compact-runtime";
import { type Card, deck as fullDeck } from "../src/poker/cards.ts";
import { evaluate } from "../src/poker/hand.ts";
import type { Ledger } from "./build/deal/contract/index.js";

// What a player's client computes from the ledger and its own deck key: reading cards,
// choosing the five to show, proposing the pot split. Witnesses for show_hand and settle
// come from here; tests use it to check the contract against src/poker.

/** Card index k (suit * 13 + rank, suits c d h s) as a card name; the contract's convention. */
const CARDS: Card[] = fullDeck();
export const cardName = (k: number): Card => CARDS[k]!;

const same = (p: JubjubPoint, q: JubjubPoint) => p.x === q.x && p.y === q.y;
export const shareKey = (pos: number, seat: number) => BigInt(pos * 8 + seat);
const seats = [0, 1, 2, 3, 4, 5];

/** Dealing order of a seat: players in the deal below it. */
export function orderOf(l: Ledger, seat: number): number {
  return seats.filter((k) => k < seat && l.in_deal[k]).length;
}

/**
 * Opens a card of the current deck with every posted share for it. For the reader's own
 * card pass `own`: their share is never posted, their deck key takes its place.
 */
export function openCard(l: Ledger, pos: number, own?: { seat: number; x: bigint }): number {
  const c = l.deck[pos]!;
  let m = c.b;
  for (const j of seats) {
    if (!l.in_deal[j] || (own && j === own.seat)) continue;
    const key = shareKey(pos, j);
    if (!l.shares_posted.member(key)) throw new Error(`no share for position ${pos} from seat ${j}`);
    m = ecAdd(m, ecNeg(l.shares_posted.lookup(key)));
  }
  if (own) m = ecAdd(m, ecNeg(ecMul(c.a, own.x)));
  const k = l.fresh.findIndex((f) => same(f.b, m));
  if (k < 0) throw new Error(`position ${pos} is not a card`);
  return k;
}

export function holeCards(l: Ledger, seat: number, x: bigint): [number, number] {
  const own = 2 * orderOf(l, seat);
  return [openCard(l, own, { seat, x }), openCard(l, own + 1, { seat, x })];
}

/** Another seat's hole cards, readable only once that seat has shown; null otherwise. */
export function shownCards(l: Ledger, seat: number): [number, number] | null {
  const own = 2 * orderOf(l, seat);
  try {
    return [openCard(l, own), openCard(l, own + 1)];
  } catch {
    return null;
  }
}

export function boardCards(l: Ledger): number[] {
  const holes = 2 * Number(l.n_players);
  return [0, 1, 2, 3, 4].map((i) => openCard(l, holes + i));
}

/** Witness for show_hand: the slots (0 and 1 the hole cards, 2..6 the board) of the best five. */
export function bestFive(l: Ledger, seat: number, x: bigint): bigint[] {
  const seven = [...holeCards(l, seat, x), ...boardCards(l)];
  const names = seven.map(cardName);
  return evaluate(names).best.map((card) => BigInt(names.indexOf(card)));
}

/**
 * Witness for settle: the pot split by level, as the circuit checks it. Every distinct
 * amount a live player put in is a level (the lowest such seat stands for it); the chips
 * between one level and the next go to the best score among the live players who reached
 * it. Returns the equal share and the odd chips per level seat, zeros elsewhere.
 */
export function splits(l: Ledger): { share: bigint[]; odd: bigint[] } {
  const live = (i: number) => l.in_deal[i]! && !l.folded[i]!;
  const c = l.total;
  const sc = seats.map((i) => (live(i) ? l.scores.lookup(BigInt(i)) : 0n));
  const min = (a: bigint, b: bigint) => (a < b ? a : b);
  const share: bigint[] = [];
  const odd: bigint[] = [];
  for (const j of seats) {
    const level = c[j]!;
    const rep = live(j) && !seats.some((i) => i < j && live(i) && c[i] === level);
    if (!rep) {
      share.push(0n);
      odd.push(0n);
      continue;
    }
    const prev = seats.filter((i) => live(i) && c[i]! < level).reduce((m, i) => (c[i]! > m ? c[i]! : m), 0n);
    const layer = seats.filter((i) => l.in_deal[i]).reduce((sum, i) => sum + min(c[i]!, level) - min(c[i]!, prev), 0n);
    const eligible = seats.filter((i) => live(i) && c[i]! >= level);
    const best = eligible.reduce((m, i) => (sc[i]! > m ? sc[i]! : m), 0n);
    const winners = BigInt(eligible.filter((i) => sc[i] === best).length);
    share.push(layer / winners);
    odd.push(layer % winners);
  }
  return { share, odd };
}
