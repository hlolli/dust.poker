import { expect, test } from "bun:test";
import { player, Table } from "../contracts/harness.ts";
import { playProofShowdown } from "./proof-showdown.ts";

test("the proof gate collects the buy-in and withdrawal even when both players play the board", async () => {
  // Leaving the deck in order puts the six through ten of clubs on the board.
  const deck = Array.from({ length: 52 }, (_, i) => BigInt(i));
  const t = await Table.seated(2, [player(deck), player(deck)]);
  await playProofShowdown(t);
  expect(t.ledger.stack.slice(0, 2)).toEqual([200n, 200n]);
  for (const circuit of ["settle", "stand_up", "leave", "buy_in"] as const) {
    expect(t.preimages.get(circuit)?.byteLength).toBeGreaterThan(0);
  }
}, 60_000);
