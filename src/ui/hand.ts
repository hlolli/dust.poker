import { type Card, type Rank, rankOf, rankValue, suitOf } from "../poker/cards.ts";
import { evaluate } from "../poker/hand.ts";
import type { TableState } from "../referee/types.ts";

/**
 * Your hand, readable: small cards in the corner above the action bar, the board beside
 * them, and a line saying what you hold ("Two pair, jacks and fours"). A duplicate of what
 * is on the felt, for eyes that cannot make the felt out. Styled in src/index.html (.hand).
 */
export class HandPanel {
  readonly el = document.createElement("aside");
  private readonly hole = document.createElement("div");
  private readonly board = document.createElement("div");
  private readonly hint = document.createElement("p");
  private last = "";

  constructor() {
    this.el.className = "hand";
    this.hole.className = "cards hole";
    this.board.className = "cards board";
    this.hint.className = "hint";
    this.el.append(this.hole, this.board, this.hint);
    this.el.hidden = true;
  }

  update(s: TableState) {
    const you = s.seats[s.you];
    const hole = you?.hole ?? null;
    const key = `${hole?.join() ?? ""}|${s.board.join()}|${you?.folded}`;
    if (key === this.last) return;
    this.last = key;
    this.el.hidden = !hole && s.board.length === 0;
    this.hole.replaceChildren(...(hole ?? ["back", "back"]).map((c) => card(c as Card | "back")));
    this.board.replaceChildren(...Array.from({ length: 5 }, (_, i) => card(s.board[i] ?? null)));
    this.hint.textContent = hole ? (you?.folded ? "Folded" : describe(hole, s.board)) : "";
    this.el.classList.toggle("folded", !!you?.folded);
  }
}

const GLYPH = { c: "♣", d: "♦", h: "♥", s: "♠" } as const;

function card(c: Card | "back" | null): HTMLElement {
  const el = document.createElement("span");
  if (c === null) {
    el.className = "card empty";
    return el;
  }
  if (c === "back") {
    el.className = "card back";
    return el;
  }
  const suit = suitOf(c);
  el.className = `card ${suit === "d" || suit === "h" ? "red" : "black"}`;
  const rank = rankOf(c) === "T" ? "10" : rankOf(c);
  el.innerHTML = `<b>${rank}</b><i>${GLYPH[suit]}</i>`;
  return el;
}

const NAMES: Record<Rank, [string, string]> = {
  "2": ["two", "twos"], "3": ["three", "threes"], "4": ["four", "fours"], "5": ["five", "fives"], "6": ["six", "sixes"],
  "7": ["seven", "sevens"], "8": ["eight", "eights"], "9": ["nine", "nines"], T: ["ten", "tens"], J: ["jack", "jacks"],
  Q: ["queen", "queens"], K: ["king", "kings"], A: ["ace", "aces"],
};
const one = (c: Card) => NAMES[rankOf(c)][0];
const many = (c: Card) => NAMES[rankOf(c)][1];
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** What the hand is, in a dealer's words. Before the flop, the two cards themselves. */
export function describe(hole: Card[], board: Card[]): string {
  const [a, b] = [...hole].sort((x, y) => rankValue(y) - rankValue(x)) as [Card, Card];
  if (board.length < 3) {
    if (rankOf(a) === rankOf(b)) return `Pair of ${many(a)}`;
    return `${cap(one(a))} ${one(b)} ${suitOf(a) === suitOf(b) ? "suited" : "offsuit"}`;
  }
  const { category, best } = evaluate([...hole, ...board]);
  // Ranks in the five, grouped: count then rank, high first.
  const groups = new Map<Rank, number>();
  for (const c of best) groups.set(rankOf(c), (groups.get(rankOf(c)) ?? 0) + 1);
  const ordered = [...groups.entries()].sort((x, y) => y[1] - x[1] || rankValue(`${y[0]}c`) - rankValue(`${x[0]}c`));
  const rank = (i: number) => NAMES[ordered[i]![0]];
  const high = [...best].sort((x, y) => rankValue(y) - rankValue(x))[0]!;
  switch (category) {
    case "high card":
      return `${cap(one(high))} high`;
    case "pair":
      return `Pair of ${rank(0)[1]}`;
    case "two pair":
      return `Two pair, ${rank(0)[1]} and ${rank(1)[1]}`;
    case "three of a kind":
      return `Three ${rank(0)[1]}`;
    case "straight":
      return `Straight, ${one(high)} high`;
    case "flush":
      return `Flush, ${one(high)} high`;
    case "full house":
      return `Full house, ${rank(0)[1]} over ${rank(1)[1]}`;
    case "four of a kind":
      return `Four ${rank(0)[1]}`;
    case "straight flush":
      return rankOf(high) === "A" ? "Royal flush" : `Straight flush, ${one(high)} high`;
  }
}
