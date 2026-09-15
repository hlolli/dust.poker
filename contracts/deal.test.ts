import { expect, test } from "bun:test";
import {
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
  ecAdd,
  ecMul,
  ecNeg,
  type JubjubPoint,
} from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, pureCircuits } from "./build/deal/contract/index.js";

// A full six-player dealing round executed locally: keys, six shuffles, shares for
// twelve hole cards and five board cards, then every player reads what they may.
// No chain, no proofs; this is the Practice path and the correctness half of the benchmark.

const ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const SEATS = 6;
const coinPublicKey = "11".repeat(32);
const address = dummyContractAddress();
type PS = Record<string, never>;
type State = Parameters<typeof createCircuitContext>[3];

function randomScalar(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return (n % (ORDER - 1n)) + 1n;
}

function randomPermutation(): bigint[] {
  const p = Array.from({ length: 52 }, (_, i) => BigInt(i));
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  return p;
}

function player(permutation: bigint[] = randomPermutation()) {
  const x = randomScalar();
  const blinding = Array.from({ length: 52 }, randomScalar);
  const contract = new Contract<PS>({
    deck_key: (ctx) => [ctx.privateState, x],
    // The circuit takes the deck already in secret order; the permutation itself stays here.
    permuted: (ctx) => [ctx.privateState, permutation.map((p) => ctx.ledger.deck[Number(p)]!)],
    blinding: (ctx) => [ctx.privateState, blinding],
  });
  return { x, contract };
}

async function call<C extends "post_key" | "shuffle" | "shares">(
  p: ReturnType<typeof player>,
  state: State,
  circuit: C,
  ...args: (bigint | bigint[])[]
): Promise<{ state: State; result: unknown }> {
  const ctx = createCircuitContext(circuit, address, coinPublicKey, state, {} as PS);
  const r = await (p.contract.circuits[circuit] as (c: typeof ctx, ...a: (bigint | bigint[])[]) => Promise<{ context: typeof ctx; result: unknown }>)(ctx, ...args);
  return { state: r.context.callContext.currentQueryContext.state, result: r.result };
}

/** Ten positions for the `shares` circuit: fewer are padded by repeating the last one. */
const ten = (positions: number[]): bigint[] => Array.from({ length: 10 }, (_, i) => BigInt(positions[Math.min(i, positions.length - 1)]!));

const same = (p: JubjubPoint, q: JubjubPoint) => p.x === q.x && p.y === q.y;
const cardTable = Array.from({ length: 52 }, (_, k) => pureCircuits.card_point(BigInt(k)));
const cardIndex = (m: JubjubPoint) => cardTable.findIndex((c) => same(c, m));

test("six players deal a deck; each reads only their own cards and the board", async () => {
  const players = Array.from({ length: SEATS }, () => player());
  let s: State = (await players[0]!.contract.initialState(createConstructorContext<PS>({}, coinPublicKey))).currentContractState;

  let t = performance.now();
  for (let i = 0; i < SEATS; i++) s = (await call(players[i]!, s, "post_key", BigInt(i))).state;
  const keysMs = performance.now() - t;

  t = performance.now();
  for (let i = 0; i < SEATS; i++) s = (await call(players[i]!, s, "shuffle")).state;
  const shuffleMs = performance.now() - t;
  expect(ledger(s).shuffles_done).toBe(6n);

  // Positions: seat i holds 2i and 2i+1; the board is 12..16.
  const holes = (i: number) => [2 * i, 2 * i + 1];
  const board = [12, 13, 14, 15, 16];
  const shares = new Map<number, Map<number, JubjubPoint>>(); // pos -> seat -> share

  // Two batched calls per player: the other players' hole positions, then the board.
  t = performance.now();
  for (let j = 0; j < SEATS; j++) {
    const others = Array.from({ length: SEATS }, (_, i) => i).filter((i) => i !== j).flatMap(holes);
    for (const positions of [others, board]) {
      const r = await call(players[j]!, s, "shares", BigInt(j), ten(positions));
      s = r.state;
      (r.result as JubjubPoint[]).forEach((share, i) => {
        const pos = Number(ten(positions)[i]);
        if (!shares.has(pos)) shares.set(pos, new Map());
        shares.get(pos)!.set(j, share);
      });
    }
  }
  const shareMs = performance.now() - t;

  const deck = ledger(s).deck;
  const read = (pos: number, reader: number): number => {
    const c = deck[pos]!;
    let m = c.b;
    for (const [seat, share] of shares.get(pos)!) if (seat !== reader) m = ecAdd(m, ecNeg(share));
    m = ecAdd(m, ecNeg(ecMul(c.a, players[reader]!.x)));
    return cardIndex(m);
  };

  const dealt: number[] = [];
  for (let i = 0; i < SEATS; i++) for (const pos of holes(i)) dealt.push(read(pos, i));
  // The board has a share from everyone, so it decodes without any private key.
  for (const pos of board) {
    const c = deck[pos]!;
    let m = c.b;
    for (const share of shares.get(pos)!.values()) m = ecAdd(m, ecNeg(share));
    dealt.push(cardIndex(m));
  }

  expect(dealt.every((k) => k >= 0 && k < 52)).toBe(true);
  expect(new Set(dealt).size).toBe(17); // twelve hole cards and five board cards, all distinct

  // A hole card is unreadable without its holder's key: the wrong key decodes to no card.
  expect(read(0, 1)).toBe(-1);

  console.log(`local dealing: keys ${keysMs.toFixed(0)} ms, 6 shuffles ${shuffleMs.toFixed(0)} ms, 12 share batches ${shareMs.toFixed(0)} ms`);
}, 120_000);

test("a shuffle that is not a permutation is rejected", async () => {
  const honest = player();
  const cheat = player([0n, 0n, ...Array.from({ length: 50 }, (_, i) => BigInt(i + 2))]);
  let s: State = (await honest.contract.initialState(createConstructorContext<PS>({}, coinPublicKey))).currentContractState;
  s = (await call(honest, s, "post_key", 0n)).state;
  await expect(call(cheat, s, "shuffle")).rejects.toThrow(/not a permutation/);
});

test("a share must match the seat's posted key", async () => {
  const [a, b] = [player(), player()];
  let s: State = (await a.contract.initialState(createConstructorContext<PS>({}, coinPublicKey))).currentContractState;
  s = (await call(a, s, "post_key", 0n)).state;
  s = (await call(b, s, "post_key", 1n)).state;
  s = (await call(a, s, "shuffle")).state;
  await expect(call(a, s, "shares", 1n, ten([3]))).rejects.toThrow(/does not match/);
});
