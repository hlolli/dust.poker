export const SUITS = ["c", "d", "h", "s"] as const;
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
/** A card as two characters, rank then suit: "As", "Td", "2c". */
export type Card = `${Rank}${Suit}`;

export function deck(): Card[] {
  return SUITS.flatMap((s) => RANKS.map((r): Card => `${r}${s}`));
}
