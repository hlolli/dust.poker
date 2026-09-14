import { expect, test } from "bun:test";
import type { Card } from "./cards.ts";
import { applyAction, type Deal, legalActions, startDeal } from "./deal.ts";

// Deck is dealt from the top, one card per player per round, starting left of the dealer.
const rigged = (s: string) => s.split(" ") as Card[];
const pot = (d: Deal) => d.seats.reduce((a, s) => a + (s?.total ?? 0), 0);

test("three-handed: blinds, order, and folding to the big blind", () => {
  // Dealer 0; SB is 1, BB is 2; UTG (0) acts first preflop.
  let d = startDeal([100, 100, 100], 0, 2, rigged("Ah Kh Qh Ad Kd Qd 2c 3c 4c 5c 6c 7c 8c"));
  expect(d.seats[1]!.bet).toBe(1);
  expect(d.seats[2]!.bet).toBe(2);
  expect(d.toAct).toBe(0);
  expect(legalActions(d, 0)).toEqual({ check: false, call: 2, raise: { min: 4, max: 100 } });

  d = applyAction(d, 0, { type: "fold" });
  d = applyAction(d, 1, { type: "fold" });
  expect(d.result).not.toBeNull();
  expect(d.result!.showdown).toBe(false);
  expect(d.result!.payouts).toEqual([0, 0, 3]);
  expect(d.seats[2]!.stack).toBe(101);
});

test("big blind gets the option, then the flop is dealt and action starts left of the dealer", () => {
  let d = startDeal([100, 100, 100], 0, 2, rigged("Ah Kh Qh Ad Kd Qd 2c 3c 4c 5c 6c 7c 8c"));
  d = applyAction(d, 0, { type: "call" });
  d = applyAction(d, 1, { type: "call" });
  expect(d.street).toBe("preflop");
  expect(d.toAct).toBe(2); // the option
  expect(legalActions(d, 2).check).toBe(true);
  d = applyAction(d, 2, { type: "check" });
  expect(d.street).toBe("flop");
  expect(d.board).toEqual(rigged("2c 3c 4c"));
  expect(d.toAct).toBe(1);
  expect(d.currentBet).toBe(0);
  expect(legalActions(d, 1).raise).toEqual({ min: 2, max: 98 });
});

test("min-raise grows with the last raise; a short all-in does not reopen action", () => {
  let d = startDeal([100, 100, 25], 0, 2, rigged("Ah Kh Qh Ad Kd Qd 2c 3c 4c 5c 6c 7c 8c"));
  d = applyAction(d, 0, { type: "raise", to: 6 }); // raise by 4
  expect(legalActions(d, 1).raise!.min).toBe(10);
  d = applyAction(d, 1, { type: "raise", to: 20 }); // raise by 14, next min raise is to 34
  // Seat 2 has 23 behind after posting 2: covers the call, but can only shove to 25, short of 34.
  expect(legalActions(d, 2).raise).toEqual({ min: 25, max: 25 });
  d = applyAction(d, 2, { type: "raise", to: 25 });
  // Seat 0 faces a full raise (to 20) and may re-raise; seat 1 only faces the short 5 and may not.
  expect(d.toAct).toBe(0);
  expect(legalActions(d, 0).raise).toEqual({ min: 39, max: 100 }); // 25 + the last full raise of 14
  d = applyAction(d, 0, { type: "call" });
  expect(d.toAct).toBe(1);
  expect(legalActions(d, 1)).toEqual({ check: false, call: 5, raise: null });
  d = applyAction(d, 1, { type: "call" });
  expect(d.street).toBe("flop");
});

test("all-in and called runs the board out to a showdown with side pots", () => {
  // Cards go seat 1, 2, 0 per round: seat 1 gets Kc Qc (flush), seat 2 7d 8d, seat 0 Ah As (wheel).
  let d = startDeal([100, 100, 30], 0, 2, rigged("Kc 7d Ah Qc 8d As 2c 3c 4c 9h 5c"));
  d = applyAction(d, 0, { type: "raise", to: 100 });
  d = applyAction(d, 1, { type: "call" });
  d = applyAction(d, 2, { type: "call" });
  expect(d.result!.showdown).toBe(true);
  expect(d.board).toHaveLength(5);
  expect(d.result!.ranks[1]!.category).toBe("flush");
  // Main pot 90 to the flush, side pot 140 to the flush too. Seat 2 busts.
  expect(d.result!.payouts).toEqual([0, 230, 0]);
  expect(d.seats.map((s) => s!.stack)).toEqual([0, 230, 0]);
  expect(pot(d)).toBe(230);
});

test("heads-up: dealer posts the small blind and acts first preflop", () => {
  const d = startDeal([50, 50], 1, 2, rigged("Ah Kh Ad Kd 2c 3c 4c 5c 6c"));
  expect(d.seats[1]!.bet).toBe(1);
  expect(d.seats[0]!.bet).toBe(2);
  expect(d.toAct).toBe(1);
});

test("illegal actions throw and leave the deal untouched", () => {
  const d = startDeal([100, 100, 100], 0, 2, rigged("Ah Kh Qh Ad Kd Qd 2c 3c 4c 5c 6c 7c 8c"));
  expect(() => applyAction(d, 1, { type: "fold" })).toThrow();
  expect(() => applyAction(d, 0, { type: "check" })).toThrow();
  expect(() => applyAction(d, 0, { type: "raise", to: 3 })).toThrow();
  expect(d.toAct).toBe(0);
});
