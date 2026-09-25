import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { keyMaterial } from "../../contracts/harness.ts";
import { Seat } from "../referee/contract.ts";
import type { TableState } from "../referee/types.ts";
import { bytes } from "./ledger.ts";
import { joinOn } from "./live.ts";
import { LocalChain } from "./local.ts";
import { type KeyStore, LiveReferee } from "./referee.ts";

// Two players, each with their own Live referee, play a deal against a chain in memory: every
// step is a transaction, each client performs only its own seat's, and the deal reaches its
// end through the chain alone. Verifier keys are the real ones when built, else one real key
// for every circuit (the local chain does not check proofs).

const root = `${import.meta.dir}/../..`;
const keys = keyMaterial(root);
// Without built keys (ci.yml has no prover), every circuit gets any.verifier: a real verifier key
// of one small circuit, kept here because the ledger accepts nothing but a well-formed key.
const verifierKey = async (circuit: string) => (existsSync(`${root}/contracts/build/deal/keys/${circuit}.verifier`) ? (await keys.lookupKey(circuit)).verifierKey : Bun.file(`${import.meta.dir}/any.verifier`).bytes());

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
  // The chain pushes every change; the poll is far apart, so the deal can only move on the pushes.
  const a = new LiveReferee(chain, alice, { poll: 5000, betweenDeals: 100 });
  const b = new LiveReferee(chain, bob, { poll: 5000, betweenDeals: 100 });
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

test("a reload mid-deal: the seat is taken back without a join and the deck keys come back from the store", async () => {
  const chain = await LocalChain.deploy(verifierKey);
  const keep = (): KeyStore & { kept: ReturnType<KeyStore["load"]> } => ({ kept: null, load: function () { return this.kept; }, save: function (k) { this.kept = k; } });
  const aliceKeys = keep();
  const alice = new Seat("Alice");
  const bob = new Seat("Bob");
  await joinOn(chain, alice, bytes(chain.me));
  await joinOn(chain, bob, bytes(chain.me));
  const a = new LiveReferee(chain, alice, { poll: 5000, betweenDeals: 100, store: aliceKeys });
  const b = new LiveReferee(chain, bob, { poll: 5000, betweenDeals: 100, store: keep() });
  a.start();
  b.start();
  let a2: LiveReferee | null = null;
  try {
    const sa = await until(a, (s) => s.street === "preflop" && s.toAct !== null);
    expect(sa.seats[0]!.hole).toHaveLength(2);
    expect(aliceKeys.kept?.dealNo).toBe(1n);
    // Alice's page reloads: a new Seat from the same secret, no join (she holds seat 0), a new referee with her store.
    a.stop();
    const applied = chain.applied;
    const again = new Seat("Alice", alice.secret);
    expect(await joinOn(chain, again, bytes(chain.me))).toBe(0);
    expect(chain.applied).toBe(applied);
    a2 = new LiveReferee(chain, again, { poll: 5000, betweenDeals: 100, store: aliceKeys });
    a2.start();
    const back = await until(a2, (s) => s.seats[0]!.hole !== null);
    expect(back.seats[0]!.hole).toEqual(sa.seats[0]!.hole); // the same cards: this deal's key came back
    // The deal plays out, and the next one uses the deck prepared with the key she posted before the reload.
    const actor = back.toAct === 0 ? a2 : b;
    await actor.act({ type: "fold" });
    await until(b, (s) => s.street === "between" && s.message.includes("win"));
    const next = await until(a2, (s) => s.street === "preflop" && s.toAct !== null && s.seats[0]!.hole !== null, 90_000);
    expect(next.seats[0]!.hole).toHaveLength(2);
    expect(aliceKeys.kept?.dealNo).toBe(2n);
  } finally {
    a.stop();
    a2?.stop();
    b.stop();
  }
}, 180_000);
