import { expect, test } from "bun:test";
import { deck } from "./cards.ts";

test("a deck has 52 distinct cards", () => {
  const d = deck();
  expect(d).toHaveLength(52);
  expect(new Set(d).size).toBe(52);
});
