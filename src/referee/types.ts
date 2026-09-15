import type { Card } from "../poker/cards.ts";

export type Street = "preflop" | "flop" | "turn" | "river";

export type Action = { type: "fold" } | { type: "check" } | { type: "call" } | { type: "raise"; to: number };

export interface Legal {
  check: boolean;
  /** Chips needed to call; 0 when checking is legal. */
  call: number;
  /** Raise "to" amounts for this street, all-in included; null when no raise is possible. */
  raise: { min: number; max: number } | null;
}

/**
 * Everything the scene may know. Never the deck, never another seat's hole cards
 * before showdown. A Practice and a Live table both produce this; the scene
 * cannot tell them apart.
 */
export interface TableState {
  seats: SeatView[];
  dealer: number;
  street: Street | "showdown" | "between";
  board: Card[];
  pot: number;
  toAct: number | null;
  /** Your seat index. */
  you: number;
  /** Your legal actions when it is your turn, else null. */
  legal: Legal | null;
  bigBlind: number;
  /** One line for the table: who won what, or empty. */
  message: string;
  /** You may open your own hole cards to the table now (the deal is over and you were dealt in). */
  canShow: boolean;
}

export interface SeatView {
  /** null for an empty seat. */
  name: string | null;
  stack: number;
  /** Committed this street. */
  bet: number;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  /** Your own cards always; others' only at showdown. */
  hole: Card[] | null;
  lastAction: string | null;
  isWinner: boolean;
}

export interface Referee {
  /** Calls `fn` now with the current state and again on every change. Returns unsubscribe. */
  subscribe(fn: (state: TableState) => void): () => void;
  /** May take seconds on a live table; rejects if the action is not legal. */
  act(action: Action): Promise<void>;
  /** Show your hole cards to the table; rejects unless `canShow`. */
  show(): Promise<void>;
}
