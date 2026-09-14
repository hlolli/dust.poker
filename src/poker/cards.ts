export const SUITS = ["c", "d", "h", "s"] as const;
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
/** A card as two characters, rank then suit: "As", "Td", "2c". */
export type Card = `${Rank}${Suit}`;

export function deck(): Card[] {
  return SUITS.flatMap((s) => RANKS.map((r): Card => `${r}${s}`));
}

export const rankOf = (c: Card): Rank => c[0] as Rank;
export const suitOf = (c: Card): Suit => c[1] as Suit;
/** 2 = 2 ... 14 = ace. */
export const rankValue = (c: Card): number => RANKS.indexOf(rankOf(c)) + 2;

/** Fisher-Yates; `rng` returns [0, 1). Deterministic given a deterministic rng. */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
