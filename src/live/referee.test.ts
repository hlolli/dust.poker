import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { keyMaterial } from "../../contracts/harness.ts";
import { Seat } from "../referee/contract.ts";
import type { TableState } from "../referee/types.ts";
import { bytes } from "./ledger.ts";
import { joinOn } from "./live.ts";
import { LocalChain } from "./local.ts";
import { LiveReferee } from "./referee.ts";

// Two players, each with their own Live referee, play a deal against a chain in memory: every
// step is a transaction, each client performs only its own seat's, and the deal reaches its
// end through the chain alone. Verifier keys are the real ones when built, else placeholders
// (the local chain does not check proofs).

const root = `${import.meta.dir}/../..`;
const keys = keyMaterial(root);
const verifierKey = async (circuit: string) => (existsSync(`${root}/contracts/build/deal/keys/${circuit}.verifier`) ? (await keys.lookupKey(circuit)).verifierKey : new Uint8Array(32).fill(1));

/** Waits for a table state that satisfies `ok`, or fails after `ms`. */
function until(ref: LiveReferee, ok: (s: TableState) => boolean, ms = 60_000): Promise<TableState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting: last message "${last?.message}", street ${last?.street}`));
    }, ms);
    let last: TableState | null = null;
    const off = ref.subscribe((s) => {
      last = s;
      if (ok(s)) {
        clearTimeout(timer);
        off();
        resolve(s);
      }
    });
  });
}

test("two Live referees play a deal through the chain, each for its own seat only", async () => {
  const chain = await LocalChain.deploy(verifierKey);
  const alice = new Seat("Alice");
  const bob = new Seat("Bob");
  expect(await joinOn(chain, alice, bytes(chain.me))).toBe(0);
  expect(await joinOn(chain, bob, bytes(chain.me))).toBe(1);
  const a = new LiveReferee(chain, alice, { poll: 15, betweenDeals: 100 });
  const b = new LiveReferee(chain, bob, { poll: 15, betweenDeals: 100 });
  a.start();
  b.start();
  try {
    // Alice, the lowest seat, starts the deal; both post keys, shuffle and share; someone is to act.
    const [sa, sb] = await Promise.all([until(a, (s) => s.legal !== null || (s.toAct !== null && s.toAct !== 0)), until(b, (s) => s.legal !== null || (s.toAct !== null && s.toAct !== 1))]);
    expect(sa.street).toBe("preflop");
    expect(sa.seats[0]!.hole).toHaveLength(2);
    expect(sb.seats[1]!.hole).toHaveLength(2);
    expect(sa.seats[1]!.hole).toBeNull(); // the other's cards are not readable
    expect(sa.seats.filter((s) => s.name).map((s) => s.name)).toEqual(["Alice", "Seat 2"]);
    // Whoever is to act folds; the other takes the pot, and the deal is done for both clients.
    const actor = sa.toAct === 0 ? a : b;
    await actor.act({ type: "fold" });
    const [da, db] = await Promise.all([until(a, (s) => s.street === "between" && s.message.includes("win")), until(b, (s) => s.street === "between" && s.message.includes("win"))]);
    expect(da.seats.map((s) => s.stack).reduce((x, y) => x + y, 0)).toBe(400);
    expect(db.message).toMatch(/win/);
    expect(chain.applied).toBeGreaterThanOrEqual(2 + 1 + 2 + 2 + 2 + 1); // joins, start, keys, shuffles, shares, the fold
  } finally {
    a.stop();
    b.stop();
  }
}, 120_000);
