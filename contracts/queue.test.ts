import { expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import * as L from "@midnightntwrk/ledger-v9";
import * as zkir from "@midnightntwrk/zkir-v3";
import {
  ContractState,
  createCircuitContext,
  createConstructorContext,
  proofDataIntoSerializedPreimage,
  type CircuitResults,
} from "@midnight-ntwrk/compact-runtime";
import { Contract as Queue, ledger as queueLedger } from "./build/queue/contract/index.js";
import { Contract as Reservations } from "./build/public-seat/contract/index.js";
import { ledger as dealLedger } from "./build/deal/contract/index.js";
import { keyMaterial } from "./harness.ts";
import { Seat } from "../src/referee/contract.ts";
import { Phase } from "../src/referee/rules.ts";
import { callOn, COIN_PUBLIC_KEY } from "../src/live/chain.ts";
import { bytes, hex, isOurs } from "../src/live/ledger.ts";
import { joinOn, publicPlayerKey, tableOpening } from "../src/live/live.ts";
import { LocalChain } from "../src/live/local.ts";
import { QUEUE_ADDRESS } from "../src/live/public-queue.ts";
import { beaconRound, drawRandomness, drawTables, drawTime } from "../src/live/draw.ts";

const root = `${import.meta.dir}/..`;
const mockKey = () => Bun.file(`${root}/src/live/any.verifier`).bytes();
const who = (seat: Seat) => publicPlayerKey(seat.secret);
const actors = [new Seat("Alice"), new Seat("Bob"), new Seat("Carol"), new Seat("Dee")];
const roster = actors.map(who);

test("public draws verify the exact quicknet round and its signature", async () => {
  const beacon = {
    round: 732332,
    randomness: "361adfb7f271117f227a1bd0d5c80574dc6f75eb5e320a5c04f3122363211546",
    signature: "a20daad79581be44b545176c632ce25724fc4858a23504fd8dd2ce2105e6708409b178c0afa2768eb713f9d14071230e",
  };
  const relay = spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(beacon));
  try {
    expect(await drawRandomness(5650000)).toBe(beacon.randomness);
    await expect(drawRandomness(5650001)).rejects.toThrow();
    beacon.signature = "00".repeat(48);
    await expect(drawRandomness(5650000)).rejects.toThrow();
  } finally {
    relay.mockRestore();
  }
});

test("all clients draw the same tables from a frozen roster, with at least two possible tables", async () => {
  const ids = Array.from({ length: 24 }, (_, i) => i.toString(16).padStart(64, "0"));
  const seed = "34".repeat(32);
  for (let n = 1; n <= ids.length; n++) {
    const players = ids.slice(0, n);
    const tables = await drawTables("preview", 1, players, seed);
    if (n < 4) {
      expect(tables).toEqual([]);
      continue;
    }
    expect(tables.length).toBeGreaterThanOrEqual(2);
    expect(tables.every((t) => t.length >= 2 && t.length <= 6)).toBe(true);
    expect(tables.flat().sort()).toEqual(players);
    expect(await drawTables("preview", 1, players.reverse(), seed)).toEqual(tables);
  }
  expect(await drawTables("preview", 1, ids, seed)).not.toEqual(await drawTables("preview", 1, ids, "ab".repeat(32)));
  await expect(drawTables("preview", 1, [ids[0]!, ids[0]!], seed)).rejects.toThrow("Invalid");
  const round = 5_700_000;
  expect(1692803367 + (beaconRound(round) - 1) * 3).toBeGreaterThanOrEqual(drawTime(round));
});

const round = 5_700_000n;
function context(state: ContractState, circuitId: string, time: number) {
  return createCircuitContext({
    circuitId,
    contractAddress: QUEUE_ADDRESS,
    contractState: state,
    coinPublicKeyOrZswapState: COIN_PUBLIC_KEY,
    privateState: {},
    time,
  });
}
async function registration() {
  const [a, b] = actors;
  const qa = new Queue({ player_secret: (c) => [c.privateState, a!.secret] });
  const qb = new Queue({ player_secret: (c) => [c.privateState, b!.secret] });
  const state = (await qa.initialState(createConstructorContext({}, COIN_PUBLIC_KEY))).currentContractState;
  const start = Number(round) * 300;
  const enter = await qa.circuits.enter_queue(context(state, "enter_queue", start + 1), round);
  state.data = enter.context.callContext.currentQueryContext.state;
  return { qa, qb, state, start, enter };
}
test("queue keys cannot enter twice, announce for someone else, change a proposal, or enter after close", async () => {
  const { qa, qb, state, start } = await registration();
  expect(hex(queueLedger(state.data).entrants.lookup(round).lookup(0n))).toBe(roster[0]!);
  await expect(qa.circuits.enter_queue(context(state, "enter_queue", start + 2), round)).rejects.toThrow("already in");
  await expect(qb.circuits.enter_queue(context(state, "enter_queue", start + 300), round)).rejects.toThrow("closed");
  const address = bytes("ab".repeat(32));
  await expect(qb.circuits.announce_table(context(state, "announce_table", start + 301), round, address)).rejects.toThrow(
    "not in",
  );
  await expect(qa.circuits.announce_table(context(state, "announce_table", start + 2), round, address)).rejects.toThrow(
    "still open",
  );
  const announced = await qa.circuits.announce_table(context(state, "announce_table", start + 301), round, address);
  state.data = announced.context.callContext.currentQueryContext.state;
  await expect(qa.circuits.announce_table(context(state, "announce_table", start + 301), round, address)).rejects.toThrow(
    "already announced",
  );
});

test("a public table enforces every drawn chair and accepts no replacement after cash-out", async () => {
  const chain = await LocalChain.deploy(mockKey, 10_000_000n, roster);
  const payout = bytes(chain.me);
  const [alice, bob, carol, dee] = actors;
  await expect(joinOn(chain, alice!, payout, 200n, mockKey, [...roster].reverse())).rejects.toThrow("opening");
  await expect(joinOn(chain, new Seat("Outsider"), payout, 200n, mockKey)).rejects.toThrow("circuits");
  const raw = await chain.snapshot();
  expect(raw.state!.operation("join")).toBeUndefined();
  expect(raw.state!.operation("reserve_seat")).toBeUndefined();
  const intruder = new Reservations({ player_secret: (c) => [c.privateState, 7n] });
  await expect(
    intruder.circuits.claim_seat(
      context(ContractState.deserialize(raw.state!.serialize()), "claim_seat", raw.time),
      0n,
      payout,
      200n,
    ),
  ).rejects.toThrow("reserved for another");
  await Promise.all([bob!, alice!].map((player) => joinOn(chain, player, payout, 200n, mockKey, roster)));
  await expect(callOn(chain, await chain.snapshot(), alice!, "start_deal", [])).rejects.toThrow();
  await joinOn(chain, dee!, payout, 200n, mockKey, roster);
  await joinOn(chain, carol!, payout, 200n, mockKey, roster);
  expect(bob!.index).toBe(1);
  const snap = await chain.snapshot();
  expect(dealLedger(ContractState.deserialize(snap.state!.serialize()).data).phase).toBe(Phase.idle);
  expect((await callOn(chain, snap, alice!, "start_deal", [])).tx).toBeDefined();
  expect(await joinOn(chain, new Seat("Bob", bob!.secret), payout, 200n, mockKey, roster)).toBe(1);
  await chain.submit((await callOn(chain, snap, bob!, "leave", [1n])).tx);
  await expect(joinOn(chain, bob!, payout, 200n, mockKey, roster)).rejects.toThrow();
}, 60_000);

test("a player can withdraw the stack and bond before missing opponents arrive", async () => {
  const chain = await LocalChain.deploy(mockKey, 10_000_000n, roster);
  const alice = actors[0]!;
  await joinOn(chain, alice, bytes(chain.me), 200n, mockKey, roster);
  await chain.submit((await callOn(chain, await chain.snapshot(), alice, "leave", [0n])).tx);
  const snap = await chain.snapshot();
  expect([...snap.state!.balance.values()].reduce((s, v) => s + v, 0n)).toBe(0n);
  expect(dealLedger(ContractState.deserialize(snap.state!.serialize()).data).phase).toBe(Phase.reserved);
  await expect(joinOn(chain, actors[1]!, bytes(chain.me), 200n, mockKey, roster)).rejects.toThrow("withdrew");
}, 60_000);

test.skipIf(!existsSync(`${root}/contracts/build/queue/keys/enter_queue.prover`))(
  "the canonical queue deployment authenticates and all three new on-chain operations prove",
  async () => {
    const intent = L.Intent.deserialize(
      "signature",
      "pre-proof",
      "pre-binding",
      await Bun.file(`${root}/src/live/public-queue.intent`).bytes(),
    );
    const deploy = intent.actions[0]!;
    if (!(deploy instanceof L.ContractDeploy)) throw new Error("missing deploy");
    expect(deploy.address).toBe(QUEUE_ADDRESS);
    expect(
      await isOurs(deploy.initialState, (n) => Bun.file(`${root}/contracts/build/queue/keys/${n}.verifier`).bytes(), [
        "enter_queue",
        "announce_table",
      ]),
    ).toBe(true);
    const { qa, state, start, enter } = await registration();
    const announce = await qa.circuits.announce_table(
      context(state, "announce_table", start + 301),
      round,
      bytes("ab".repeat(32)),
    );
    const seat = actors[0]!;
    const claims = new Reservations({ player_secret: (c) => [c.privateState, seat.secret] });
    const claim = await claims.circuits.claim_seat(
      context(await tableOpening(seat, roster), "claim_seat", start),
      0n,
      bytes("bc".repeat(32)),
      200n,
    );
    async function verify(run: CircuitResults, contract: string) {
      const data = run.context.callProofDataTrace.at(-1)!;
      const preimage = proofDataIntoSerializedPreimage(
        data.input,
        data.output,
        data.publicTranscript,
        data.privateTranscriptOutputs,
        data.circuitId,
      );
      expect((await zkir.prove(preimage, keyMaterial(root, contract))).length).toBeGreaterThan(0);
    }
    await verify(enter, "queue");
    await verify(announce, "queue");
    await verify(claim, "public-seat");
  },
  180_000,
);
