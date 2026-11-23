import { expect, setSystemTime, test } from "bun:test";
import { existsSync } from "node:fs";
import { ContractState as RuntimeContractState } from "@midnight-ntwrk/compact-runtime";
import * as L from "@midnightntwrk/ledger-v9";
import { ledger } from "../../contracts/build/deal/contract/index.js";
import { keyMaterial } from "../../contracts/harness.ts";
import { Seat } from "../referee/contract.ts";
import type { TableState } from "../referee/types.ts";
import { bytes } from "./ledger.ts";
import { joinOn } from "./live.ts";
import { LocalChain } from "./local.ts";
import { type KeyStore, LiveReferee } from "./referee.ts";
import { callOn, type Chain } from "./chain.ts";
import { Phase } from "../referee/rules.ts";

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
    let off = () => {};
    let done = false;
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting: last message "${last?.message}", street ${last?.street}`));
    }, ms);
    let last: TableState | null = null;
    off = ref.subscribe((s) => {
      last = s;
      if (ok(s)) {
        done = true;
        clearTimeout(timer);
        off();
        resolve(s);
      }
    });
    if (done) off(); // subscribe also delivers the current state synchronously
  });
}

test("joining verifies the locked opening even after other players have joined", async () => {
  const key = () => Bun.file(`${import.meta.dir}/any.verifier`).bytes();
  const chain = await LocalChain.deploy(key);
  const alice = new Seat("Alice");
  const bob = new Seat("Bob");
  expect(await joinOn(chain, alice, bytes(chain.me), 200n, key)).toBe(0);
  expect(await joinOn(chain, bob, bytes(chain.me), 200n, key)).toBe(1);
  expect(await joinOn(chain, new Seat("Alice", alice.secret), bytes(chain.me), 200n, key)).toBe(0);
});

test("two competing joins can retry as soon as the indexer shows who took the seat", async () => {
  const chain = await LocalChain.deploy(verifierKey);
  const payout = bytes(chain.me);
  const bob = new Seat("Bob");
  const competing: Chain = {
    network: chain.network, address: chain.address, snapshot: () => chain.snapshot(),
    submit: async () => { await joinOn(chain, new Seat("Alice"), payout); },
  };
  await expect(joinOn(competing, bob, payout)).rejects.toThrow("Another player took that seat first");
  expect(await joinOn(chain, bob, payout)).toBe(1);
});

test("joining refuses a prefilled opening, unverified history, or a still mutable opening", async () => {
  const key = () => Bun.file(`${import.meta.dir}/any.verifier`).bytes();
  const chain = await LocalChain.deploy(key);
  await joinOn(chain, new Seat("Alice"), bytes(chain.me));
  // The expected keys also fit a state with an invented initial stack, without escrow.
  const prefilled = (await chain.snapshot()).state!;
  prefilled.balance = new Map();
  const mutable = await chain.opening();
  mutable.maintenanceAuthority = new L.ContractMaintenanceAuthority([], 0, 0n);
  const applied = chain.applied;
  for (const opened of [prefilled, mutable, null]) {
    const source = {
      network: chain.network,
      address: chain.address,
      snapshot: () => chain.snapshot(),
      opening: async () => opened,
      submit: (tx: L.UnprovenTransaction) => chain.submit(tx),
    };
    await expect(joinOn(source, new Seat("Bob"), bytes(chain.me), 200n, key)).rejects.toThrow("opening could not be verified");
    expect(chain.applied).toBe(applied);
  }
});

test("Live publishes every buy-in, including changes inside a serialized state", async () => {
  const chain = await LocalChain.deploy(() => Bun.file(`${import.meta.dir}/any.verifier`).bytes());
  const alice = new Seat("Alice", 1n);
  await joinOn(chain, alice, bytes(chain.me), 80n);
  const ref = new LiveReferee(chain, alice, { poll: 20 });
  ref.start();
  try {
    await until(ref, (s) => s.seats[0]!.stack === 80);
    for (let stack = 81; stack <= 84; stack++) {
      const changed = until(ref, (s) => s.seats[0]!.stack === stack, 2000);
      await chain.submit((await callOn(chain, await chain.snapshot(), alice, "buy_in", [0n, 1n])).tx);
      expect((await changed).seats[0]!.stack).toBe(stack);
    }
  } finally {
    ref.stop();
  }
});

test("a surviving Live client expires and settles a missing lowest seat", async () => {
  const chain = await LocalChain.deploy(verifierKey);
  const alice = new Seat("Alice");
  const bob = new Seat("Bob");
  await joinOn(chain, alice, bytes(chain.me));
  await joinOn(chain, bob, bytes(chain.me));
  await chain.submit((await callOn(chain, await chain.snapshot(), alice, "start_deal", [])).tx);
  const current = () => ledger(RuntimeContractState.deserialize(chain.ledgerState.index(chain.address)!.serialize()).data);
  const ref = new LiveReferee(chain, bob, { poll: 20 });
  ref.start();
  try {
    await until(ref, () => current().keys.member(1n));
    // No Alice client exists to post the missing key or settle her own abort.
    setSystemTime(new Date(Number(current().deadline + 1n) * 1000));
    const settled = await until(ref, () => current().phase === Phase.done, 3000);
    expect(current().seat_owner.member(0n)).toBe(false);
    expect(current().stack[1]).toBe(401n);
    expect(settled.seats[0]!.name).toBeNull();
    expect(settled.message).toContain("Deal aborted");
  } finally {
    ref.stop();
    setSystemTime();
  }
});

test("Live folds at the displayed betting deadline before the bond can expire", async () => {
  const chain = await LocalChain.deploy(verifierKey);
  const alice = new Seat("Alice");
  const bob = new Seat("Bob");
  await joinOn(chain, alice, bytes(chain.me));
  await joinOn(chain, bob, bytes(chain.me));
  const a = new LiveReferee(chain, alice, { poll: 20, betweenDeals: 60_000 });
  const b = new LiveReferee(chain, bob, { poll: 20, betweenDeals: 60_000 });
  a.start();
  b.start();
  try {
    const turn = await until(a, (s) => s.legal !== null && s.legal.call > 0);
    setSystemTime(new Date(turn.deadline! * 1000));
    const result = await until(b, (s) => s.street === "between" && s.message.includes("win"), 5000);
    expect(result.seats[0]!.folded).toBe(true);
    const l = ledger(RuntimeContractState.deserialize(chain.ledgerState.index(chain.address)!.serialize()).data);
    expect(l.offender).toBe(255n);
    expect(l.seat_owner.member(0n)).toBe(true);
    expect(result.seats[0]!.stack + result.seats[1]!.stack).toBe(400);
  } finally {
    a.stop();
    b.stop();
    setSystemTime();
  }
}, 30_000);

test("a seat sitting out does not prevent the remaining players starting", async () => {
  const chain = await LocalChain.deploy(verifierKey);
  const alice = new Seat("Alice");
  const bob = new Seat("Bob");
  const carol = new Seat("Carol");
  for (const seat of [alice, bob, carol]) await joinOn(chain, seat, bytes(chain.me));
  await chain.submit((await callOn(chain, await chain.snapshot(), alice, "stand_up", [0n, true])).tx);
  const ref = new LiveReferee(chain, bob, { poll: 20 });
  ref.start();
  try {
    await until(ref, () => ledger(RuntimeContractState.deserialize(chain.ledgerState.index(chain.address)!.serialize()).data).phase === Phase.keys, 2000);
    const l = ledger(RuntimeContractState.deserialize(chain.ledgerState.index(chain.address)!.serialize()).data);
    expect(l.in_deal).toEqual([false, true, true, false, false, false]);
  } finally {
    ref.stop();
  }
});

test("a confirmed key collision is retried against the other player's updated state", async () => {
  const chain = await LocalChain.deploy(verifierKey);
  const alice = new Seat("Alice");
  const bob = new Seat("Bob");
  await joinOn(chain, alice, bytes(chain.me));
  await joinOn(chain, bob, bytes(chain.me));
  await chain.submit((await callOn(chain, await chain.snapshot(), alice, "start_deal", [])).tx);

  await Bun.sleep(0); // drain setup notifications before either client begins watching
  // Both clients build their first key post against the same snapshot. A wallet confirms
  // inclusion even when the call's fallible segment fails; LocalChain normally throws it.
  const first: { tx: L.UnprovenTransaction; resolve(): void; reject(e: unknown): void }[] = [];
  let collisions = 0;
  const included = async (tx: L.UnprovenTransaction) => {
    try { await chain.submit(tx); } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith("transaction partialSuccess")) throw e;
      collisions++;
    }
  };
  const source: Chain = {
    network: chain.network, address: chain.address,
    snapshot: () => chain.snapshot(), watch: (fn) => chain.watch(fn),
    submit(tx) {
      if (first.length >= 2) return included(tx);
      return new Promise<void>((resolve, reject) => {
        first.push({ tx, resolve, reject });
        if (first.length === 2) void (async () => {
          for (const pending of first) {
            try { await included(pending.tx); pending.resolve(); } catch (e) { pending.reject(e); }
          }
        })();
      });
    },
  };
  const a = new LiveReferee(source, alice, { poll: 10, retry: 60_000 });
  const b = new LiveReferee(source, bob, { poll: 10, retry: 60_000 });
  a.start();
  b.start();
  try {
    await Promise.all([until(a, (s) => s.street === "preflop", 20_000), until(b, (s) => s.street === "preflop", 20_000)]);
    expect(collisions).toBeGreaterThan(0);
  } finally {
    a.stop();
    b.stop();
  }
}, 30_000);

test("a confirmed call that leaves the contract unchanged is not repeatedly submitted", async () => {
  const chain = await LocalChain.deploy(verifierKey);
  const alice = new Seat("Alice");
  await joinOn(chain, alice, bytes(chain.me));
  await joinOn(chain, new Seat("Bob"), bytes(chain.me));
  await chain.submit((await callOn(chain, await chain.snapshot(), alice, "start_deal", [])).tx);
  let attempts = 0;
  let reads = 0;
  const submitted = Promise.withResolvers<void>();
  const source: Chain = {
    network: chain.network, address: chain.address,
    snapshot: () => { reads++; return chain.snapshot(); },
    submit: async () => { attempts++; submitted.resolve(); }, // inclusion succeeded; the fallible call did not
  };
  const ref = new LiveReferee(source, alice, { poll: 10, retry: 60_000 });
  ref.start();
  try {
    await submitted.promise;
    await Bun.sleep(100);
    expect(reads).toBeGreaterThan(2);
    expect(attempts).toBe(1);
  } finally {
    ref.stop();
  }
});

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
    const withdrawing = actor === a ? b : a;
    withdrawing.cashOut();
    await until(withdrawing, () => ledger(RuntimeContractState.deserialize(chain.ledgerState.index(chain.address)!.serialize()).data).leaving[withdrawing.you]!);
    expect(withdrawing.cashOutState).toBe("waiting");
    await actor.act({ type: "fold" });
    const [da, db] = await Promise.all([until(a, (s) => s.street === "between" && s.message.includes("win")), until(b, (s) => s.street === "between" && s.message.includes("win"))]);
    expect(da.seats.map((s) => s.stack).reduce((x, y) => x + y, 0)).toBe(400);
    expect(db.message).toMatch(/win/);
    expect(chain.applied).toBeGreaterThanOrEqual(2 + 1 + 2 + 2 + 2 + 1); // joins, start, keys, shuffles, shares, the fold
    await until(withdrawing, () => withdrawing.cashOutState === "closed");
    actor.cashOut();
    await until(actor, () => actor.cashOutState === "closed");
    expect([...chain.ledgerState.index(chain.address)!.balance.values()].reduce((sum, value) => sum + value, 0n)).toBe(0n);
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
