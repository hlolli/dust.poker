import type { Card } from "../poker/cards.ts";
import type { Action, Legal, Street } from "../poker/deal.ts";

export type { Action, Legal };

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
}
