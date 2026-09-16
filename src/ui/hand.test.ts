import { expect, test } from "bun:test";
import { describe } from "./hand.ts";

test("the hand in a dealer's words", () => {
  expect(describe(["Kh", "Kd"], [])).toBe("Pair of kings");
  expect(describe(["4h", "Ah"], [])).toBe("Ace four suited");
  expect(describe(["Jc", "4h"], [])).toBe("Jack four offsuit");
  expect(describe(["Jc", "4h"], ["4d", "Js", "2c"])).toBe("Two pair, jacks and fours");
  expect(describe(["Jc", "4h"], ["4d", "9s", "2c"])).toBe("Pair of fours");
  expect(describe(["Jc", "4h"], ["7d", "9s", "2c", "Ks"])).toBe("King high");
  expect(describe(["Th", "9h"], ["8h", "7h", "2h"])).toBe("Flush, ten high");
  expect(describe(["Th", "9d"], ["8h", "7h", "6c"])).toBe("Straight, ten high");
  expect(describe(["Kh", "Kd"], ["Ks", "4h", "4c"])).toBe("Full house, kings over fours");
  expect(describe(["Ah", "Kh"], ["Qh", "Jh", "Th"])).toBe("Royal flush");
  expect(describe(["7h", "7d"], ["7s", "7c", "2c", "3d"])).toBe("Four sevens");
});
