import { expect, test } from "bun:test";
import { ContractReferee } from "./contract.ts";
import type { TableState } from "./types.ts";

test("the contract referee deals through the circuits, hides other hole cards, and bots play to a result", async () => {
  const ref = new ContractReferee({
    names: ["You", "Dean", "Frank", null, "Sammy", "Peggy"],
    you: 0,
    botDelay: [0, 0],
    betweenDeals: 60_000,
  });
  const states: TableState[] = [];
  ref.subscribe((s) => states.push(s));
  await ref.start();

  // Call whenever it is our turn; bots play themselves out. Always calling reaches showdowns.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const s = states.at(-1)!;
    if (/win|aborted|Game over/.test(s.message)) break;
    if (s.toAct === 0 && s.legal) await ref.act(s.legal.check ? { type: "check" } : { type: "call" });
    else await new Promise((r) => setTimeout(r, 5));
  }
  ref.stop();

  const preflop = states.find((s) => s.street === "preflop")!;
  expect(preflop.seats[0]!.hole).toHaveLength(2);
  expect(preflop.seats[1]!.hole).toBeNull();
  expect(preflop.seats[3]!.name).toBeNull();
  expect(preflop.pot).toBe(3);
  expect(preflop.dealer).toBe(0);

  const last = states.at(-1)!;
  expect(last.message).toMatch(/win/);
  expect(last.seats.reduce((a, s) => a + s.stack, 0)).toBe(5 * 200); // chips are conserved
  // Something was dealt and seen along the way: a board on the flop or later, if the deal got there.
  const withBoard = states.find((s) => s.board.length >= 3);
  if (withBoard) expect(withBoard.board.every((c) => /^[2-9TJQKA][cdhs]$/.test(c))).toBe(true);
}, 60_000);
