import { expect, test } from "bun:test";
import {
  type CircuitContext,
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, pureCircuits } from "./build/seating/contract/index.js";

// Runs the compiled circuits locally: no chain, no proof server. This is exactly
// how a Practice table will call the referee once the poker circuits exist.

const coinPublicKey = "11".repeat(32);
const address = dummyContractAddress();
const sk = (n: number) => new Uint8Array(32).fill(n);
const pk = (n: number) => pureCircuits.public_key(sk(n));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

type PS = Record<string, never>;

/** One player's view of the contract: same public state, their own secret as witness. */
function player(n: number) {
  return new Contract<PS>({ player_secret_key: (ctx) => [ctx.privateState, sk(n)] });
}

async function call<R>(
  contract: Contract<PS>,
  state: Parameters<typeof createCircuitContext>[3],
  circuit: "join" | "leave",
): Promise<{ state: Parameters<typeof createCircuitContext>[3]; result: R }> {
  const ctx: CircuitContext<PS> = createCircuitContext(circuit, address, coinPublicKey, state, {});
  const r = await contract.circuits[circuit](ctx);
  return { state: r.context.callContext.currentQueryContext.state, result: r.result as R };
}

test("seating: emptiest table first, then lowest id; leave frees the seat", async () => {
  const [a, b, c] = [player(1), player(2), player(3)];
  let { currentContractState: state } = await a.initialState(createConstructorContext<PS>({}, coinPublicKey));
  let s: Parameters<typeof createCircuitContext>[3] = state;

  expect(ledger(state.data).occupancy.lookup(0n)).toBe(0n);

  let r = await call<bigint>(a, s, "join");
  s = r.state;
  expect(r.result).toBe(0n); // table 0, seat 0

  r = await call<bigint>(b, s, "join");
  s = r.state;
  expect(r.result).toBe(8n); // table 1 is emptier

  r = await call<bigint>(c, s, "join");
  s = r.state;
  expect(r.result).toBe(1n); // tie on score and occupancy, lowest id wins: table 0, seat 1

  const l = ledger(s);
  expect(l.occupancy.lookup(0n)).toBe(2n);
  expect(l.occupancy.lookup(1n)).toBe(1n);
  expect(hex(l.seats.lookup(1n))).toBe(hex(pk(3)));
  expect(l.seated.member(pk(2))).toBe(true);

  await expect(call(a, s, "join")).rejects.toThrow(/already seated/);

  r = await call(c, s, "leave");
  s = r.state;
  expect(ledger(s).occupancy.lookup(0n)).toBe(1n);
  expect(ledger(s).seated.member(pk(3))).toBe(false);
  await expect(call(c, s, "leave")).rejects.toThrow(/not seated/);
});

test("seating: a player who has sat with you before pushes you to the other table", async () => {
  const [a, b, c] = [player(1), player(2), player(3)];
  const { currentContractState } = await a.initialState(createConstructorContext<PS>({}, coinPublicKey));
  let s: Parameters<typeof createCircuitContext>[3] = currentContractState;

  s = (await call(a, s, "join")).state; // table 0
  s = (await call(b, s, "join")).state; // table 1
  s = (await call(c, s, "join")).state; // table 0, with A: history(A,C) = 1
  s = (await call(c, s, "leave")).state;

  // Both tables now have one player. Plain tie-breaking would put C back at table 0,
  // but C has history with A there and none with B.
  const r = await call<bigint>(c, s, "join");
  expect(r.result).toBe(9n); // table 1, seat 1
});
