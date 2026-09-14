import { expect, test } from "bun:test";
import { settle } from "./payout.ts";

test("side pots: the short all-in only wins what it covered", () => {
  // A all-in 50 with the best hand, B all-in 100 second best, C 100 worst.
  const p = settle(
    [
      { total: 50, folded: false, score: 3 },
      { total: 100, folded: false, score: 2 },
      { total: 100, folded: false, score: 1 },
    ],
    2,
  );
  expect(p).toEqual([150, 100, 0]);
});

test("a chop splits the layer, odd chip to the first seat after the dealer", () => {
  const p = settle(
    [
      { total: 33, folded: false, score: 5 },
      { total: 33, folded: false, score: 5 },
      { total: 33, folded: true, score: 0 },
    ],
    0,
  );
  expect(p).toEqual([49, 50, 0]);
});

test("folded chips go to whoever wins the layer they belong to", () => {
  const p = settle(
    [
      { total: 20, folded: true, score: 0 },
      { total: 60, folded: false, score: 1 },
      null,
      { total: 60, folded: false, score: 9 },
    ],
    1,
  );
  expect(p).toEqual([0, 0, 0, 140]);
});

test("uncalled excess returns to the bigger stack", () => {
  const p = settle(
    [
      { total: 100, folded: false, score: 1 },
      { total: 40, folded: false, score: 7 },
    ],
    0,
  );
  expect(p).toEqual([60, 80]);
});
