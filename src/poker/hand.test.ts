import { expect, test } from "bun:test";
import type { Card } from "./cards.ts";
import { evaluate } from "./hand.ts";

const h = (s: string) => s.split(" ") as Card[];

test("categories rank in the right order", () => {
  const ladder = [
    "2c 5d 9h Js Kc",
    "2c 2d 9h Js Kc",
    "2c 2d 9h 9s Kc",
    "2c 2d 2h Js Kc",
    "3c 4d 5h 6s 7c",
    "2c 5c 9c Jc Kc",
    "2c 2d 2h Js Jc",
    "2c 2d 2h 2s Kc",
    "3c 4c 5c 6c 7c",
  ].map((s) => evaluate(h(s)));
  for (let i = 1; i < ladder.length; i++) expect(ladder[i]!.score).toBeGreaterThan(ladder[i - 1]!.score);
  expect(ladder[8]!.category).toBe("straight flush");
});

test("the wheel is a five-high straight and loses to a six-high one", () => {
  const wheel = evaluate(h("Ac 2d 3h 4s 5c"));
  expect(wheel.category).toBe("straight");
  expect(wheel.score).toBeLessThan(evaluate(h("2c 3d 4h 5s 6c")).score);
  expect(wheel.score).toBeGreaterThan(evaluate(h("Ac Ad Ah Ks Kc")).score - 1e9); // still a straight, not a high card
});

test("kickers decide between equal pairs, and equal hands chop", () => {
  expect(evaluate(h("Ac Ad 9h 5s 2c")).score).toBeGreaterThan(evaluate(h("As Ah 8h 5d 2d")).score);
  expect(evaluate(h("Ac Ad 9h 5s 2c")).score).toBe(evaluate(h("As Ah 9d 5d 2d")).score);
});

test("seven cards: picks the best five, ignoring the rest", () => {
  const r = evaluate(h("Ah Kh Qh Jh Th 2c 3d"));
  expect(r.category).toBe("straight flush");
  expect(r.best.sort()).toEqual(h("Ah Kh Qh Jh Th").sort());
  expect(evaluate(h("2c 2d 5h 5s 9c 9d Kc")).category).toBe("two pair");
});
