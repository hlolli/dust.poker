import { type Card, rankValue, suitOf } from "./cards.ts";

export const CATEGORIES = [
  "high card",
  "pair",
  "two pair",
  "three of a kind",
  "straight",
  "flush",
  "full house",
  "four of a kind",
  "straight flush",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface HandRank {
  /** Higher wins. Equal means a chop. */
  score: number;
  category: Category;
  /** The five cards that make the hand. */
  best: Card[];
}

const BASE = 15;

function score5(cards: Card[]): { score: number; category: number } {
  const vals = cards.map(rankValue).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]!));
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  // Groups by count desc, then rank desc: e.g. full house => [[trips, 3], [pair, 2]].
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const distinct = groups.map((g) => g[0]);

  let straightHigh = 0;
  if (distinct.length === 5) {
    if (vals[0]! - vals[4]! === 4) straightHigh = vals[0]!;
    else if (vals[0] === 14 && vals[1] === 5 && vals[4] === 2) straightHigh = 5; // wheel
  }

  let category: number;
  let tiebreak: number[];
  if (straightHigh && flush) [category, tiebreak] = [8, [straightHigh]];
  else if (groups[0]![1] === 4) [category, tiebreak] = [7, distinct];
  else if (groups[0]![1] === 3 && groups[1]?.[1] === 2) [category, tiebreak] = [6, distinct];
  else if (flush) [category, tiebreak] = [5, vals];
  else if (straightHigh) [category, tiebreak] = [4, [straightHigh]];
  else if (groups[0]![1] === 3) [category, tiebreak] = [3, distinct];
  else if (groups[0]![1] === 2 && groups[1]?.[1] === 2) [category, tiebreak] = [2, distinct];
  else if (groups[0]![1] === 2) [category, tiebreak] = [1, distinct];
  else [category, tiebreak] = [0, vals];

  let score = category;
  for (let i = 0; i < 5; i++) score = score * BASE + (tiebreak[i] ?? 0);
  return { score, category };
}

function* choose5<T>(items: T[]): Generator<T[]> {
  const n = items.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) yield [items[a]!, items[b]!, items[c]!, items[d]!, items[e]!];
}

/** Best five-card hand from five to seven cards. */
export function evaluate(cards: Card[]): HandRank {
  if (cards.length < 5 || cards.length > 7) throw new Error(`evaluate: need 5-7 cards, got ${cards.length}`);
  let best: HandRank | null = null;
  for (const five of choose5(cards)) {
    const { score, category } = score5(five);
    if (!best || score > best.score) best = { score, category: CATEGORIES[category]!, best: five };
  }
  return best!;
}
