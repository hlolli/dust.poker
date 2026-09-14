import { expect, test } from "bun:test";
import { PracticeReferee } from "./practice.ts";

test("a practice table deals, hides other hole cards, and plays bots through to a result", async () => {
  const ref = new PracticeReferee({
    names: ["You", "Dean", "Frank", null, "Sammy", "Peggy"],
    you: 0,
    botDelay: [0, 0],
    betweenDeals: 60_000,
  });
  const states: import("./types.ts").TableState[] = [];
  ref.subscribe((s) => states.push(s));
  ref.start();

  // Fold whenever it is our turn; bots play themselves out.
  for (let guard = 0; guard < 200; guard++) {
    const s = states.at(-1)!;
    if (s.street === "showdown" || (s.street === "between" && s.message)) break;
    if (s.toAct === 0) await ref.act({ type: "fold" });
    else await new Promise((r) => setTimeout(r, 1));
  }
  ref.stop();

  const first = states.find((s) => s.street === "preflop")!;
  expect(first.seats[0]!.hole).toHaveLength(2);
  expect(first.seats[1]!.hole).toBeNull();
  expect(first.seats[3]!.name).toBeNull();
  expect(first.pot).toBe(3);

  const last = states.at(-1)!;
  expect(last.message).not.toBe("");
  const chips = last.seats.reduce((a, s) => a + s.stack, 0);
  expect(chips).toBe(5 * 200); // chips are conserved
});
