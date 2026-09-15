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

// A full six-player deal executed locally, through the referee's bookkeeping: seats, phases,
// turns, deadlines. No chain, no proofs; this is the Practice path and the correctness half
// of the benchmark.

const ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const SEATS = 6;
const coinPublicKey = "11".repeat(32);
const address = dummyContractAddress();
type PS = Record<string, never>;
type State = Parameters<typeof createCircuitContext>[3];
type Circuit = "sit" | "start_deal" | "post_key" | "shuffle" | "shares" | "expire";
const Phase = { idle: 0, keys: 1, shuffle: 2, holes: 3, playing: 4, aborted: 5 };
const T0 = 1_700_000_000; // block time, seconds

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
    player_secret: (ctx) => [ctx.privateState, randomScalarOnce()],
    deck_key: (ctx) => [ctx.privateState, x],
    // The circuit takes the deck already in secret order; the permutation itself stays here.
    permuted: (ctx) => [ctx.privateState, permutation.map((p) => ctx.ledger.deck[Number(p)]!)],
    blinding: (ctx) => [ctx.privateState, blinding],
  });
  // One identity per player, fixed at creation.
  const secret = randomScalar();
  function randomScalarOnce() {
    return secret;
  }
  return { x, contract };
}
type Player = ReturnType<typeof player>;

async function call(p: Player, state: State, circuit: Circuit, time: number, ...args: (bigint | bigint[])[]): Promise<{ state: State; result: unknown }> {
  const ctx = createCircuitContext(circuit, address, coinPublicKey, state, {} as PS, undefined, undefined, undefined, time);
  const r = await (p.contract.circuits[circuit] as (c: typeof ctx, ...a: (bigint | bigint[])[]) => Promise<{ context: typeof ctx; result: unknown }>)(ctx, ...args);
  return { state: r.context.callContext.currentQueryContext.state, result: r.result };
}

/** Ten positions for the `shares` circuit: fewer are padded by repeating the last one. */
const ten = (positions: number[]): bigint[] => Array.from({ length: 10 }, (_, i) => BigInt(positions[Math.min(i, positions.length - 1)]!));

const same = (p: JubjubPoint, q: JubjubPoint) => p.x === q.x && p.y === q.y;
const cardTable = Array.from({ length: 52 }, (_, k) => pureCircuits.card_point(BigInt(k)));
const cardIndex = (m: JubjubPoint) => cardTable.findIndex((c) => same(c, m));

async function seated(players: Player[]): Promise<State> {
  let s: State = (await players[0]!.contract.initialState(createConstructorContext<PS>({}, coinPublicKey))).currentContractState;
  for (let i = 0; i < players.length; i++) s = (await call(players[i]!, s, "sit", T0, BigInt(i))).state;
  return s;
}

test("six players deal a deck through the phases; each reads only their own cards and the board", async () => {
  const players = Array.from({ length: SEATS }, () => player());
  let s = await seated(players);
  const now = T0 + 10;

  s = (await call(players[3]!, s, "start_deal", now, BigInt(now))).state; // anyone may start
  expect(ledger(s).phase).toBe(Phase.keys);
  expect(ledger(s).n_players).toBe(6n);
  expect(ledger(s).deal_no).toBe(1n);

  let t = performance.now();
  for (let i = 0; i < SEATS; i++) s = (await call(players[i]!, s, "post_key", now, BigInt(i), BigInt(now))).state;
  const keysMs = performance.now() - t;
  expect(ledger(s).phase).toBe(Phase.shuffle);
  expect(ledger(s).turn).toBe(0n);
  await expect(call(players[0]!, s, "post_key", now, 0n, BigInt(now))).rejects.toThrow(/not posting keys/);
  await expect(call(players[1]!, s, "shuffle", now, 1n, BigInt(now))).rejects.toThrow(/not your turn/);
  await expect(call(players[1]!, s, "shuffle", now, 0n, BigInt(now))).rejects.toThrow(/not your seat/);

  t = performance.now();
  for (let i = 0; i < SEATS; i++) s = (await call(players[i]!, s, "shuffle", now, BigInt(i), BigInt(now))).state;
  const shuffleMs = performance.now() - t;
  expect(ledger(s).shuffles_done).toBe(6n);
  expect(ledger(s).phase).toBe(Phase.holes);

  // Positions: seat i holds 2i and 2i+1; the board is 12..16.
  const holes = (i: number) => [2 * i, 2 * i + 1];
  const board = [12, 13, 14, 15, 16];
  await expect(call(players[2]!, s, "shares", now, 2n, ten([4, 5]))).rejects.toThrow(/own hole card/);
  await expect(call(players[2]!, s, "shares", now, 2n, ten([40]))).rejects.toThrow(/position not dealt/);

  // Everyone shares the others' hole positions, then (once playing) the board.
  t = performance.now();
  for (let j = 0; j < SEATS; j++) {
    const others = Array.from({ length: SEATS }, (_, i) => i).filter((i) => i !== j).flatMap(holes);
    s = (await call(players[j]!, s, "shares", now, BigInt(j), ten(others))).state;
    expect(ledger(s).phase).toBe(j === SEATS - 1 ? Phase.playing : Phase.holes);
  }
  for (let j = 0; j < SEATS; j++) s = (await call(players[j]!, s, "shares", now, BigInt(j), ten(board))).state;
  const shareMs = performance.now() - t;
  expect(ledger(s).deadline).toBe(0n);

  const l = ledger(s);
  const share = (pos: number, seat: number) => l.shares_posted.lookup(BigInt(pos * 8 + seat));
  const read = (pos: number, reader: number): number => {
    const c = l.deck[pos]!;
    let m = c.b;
    // Every posted share except the reader's own; the holder's share of their own card is never posted.
    for (let seat = 0; seat < SEATS; seat++) {
      if (seat !== reader && l.shares_posted.member(BigInt(pos * 8 + seat))) m = ecAdd(m, ecNeg(share(pos, seat)));
    }
    m = ecAdd(m, ecNeg(ecMul(c.a, players[reader]!.x)));
    return cardIndex(m);
  };

  const dealt: number[] = [];
  for (let i = 0; i < SEATS; i++) for (const pos of holes(i)) dealt.push(read(pos, i));
  // The board has a share from everyone, so it decodes without any private key.
  for (const pos of board) {
    let m = l.deck[pos]!.b;
    for (let seat = 0; seat < SEATS; seat++) m = ecAdd(m, ecNeg(share(pos, seat)));
    dealt.push(cardIndex(m));
  }
  expect(dealt.every((k) => k >= 0 && k < 52)).toBe(true);
  expect(new Set(dealt).size).toBe(17); // twelve hole cards and five board cards, all distinct

  // A hole card is unreadable without its holder's key: the wrong key decodes to no card.
  expect(read(0, 1)).toBe(-1);

  // The next deal starts from playing and resets the deck.
  s = (await call(players[0]!, s, "start_deal", now + 60, BigInt(now + 60))).state;
  expect(ledger(s).deal_no).toBe(2n);
  expect(ledger(s).phase).toBe(Phase.keys);
  expect(ledger(s).shares_posted.isEmpty()).toBe(true);
  expect(same(ledger(s).deck[0]!.b, cardTable[0]!)).toBe(true);

  console.log(`local dealing: keys ${keysMs.toFixed(0)} ms, 6 shuffles ${shuffleMs.toFixed(0)} ms, 12 share batches ${shareMs.toFixed(0)} ms`);
}, 120_000);

test("a shuffle that is not a permutation is rejected", async () => {
  const honest = player();
  const cheat = player([0n, 0n, ...Array.from({ length: 50 }, (_, i) => BigInt(i + 2))]);
  let s = await seated([honest, cheat]);
  s = (await call(honest, s, "start_deal", T0, BigInt(T0))).state;
  s = (await call(honest, s, "post_key", T0, 0n, BigInt(T0))).state;
  s = (await call(cheat, s, "post_key", T0, 1n, BigInt(T0))).state;
  s = (await call(honest, s, "shuffle", T0, 0n, BigInt(T0))).state;
  await expect(call(cheat, s, "shuffle", T0, 1n, BigInt(T0))).rejects.toThrow(/not a permutation/);
});

test("a share must match the seat's posted key", async () => {
  const [a, b] = [player(), player()];
  let s = await seated([a, b]);
  s = (await call(a, s, "start_deal", T0, BigInt(T0))).state;
  s = (await call(a, s, "post_key", T0, 0n, BigInt(T0))).state;
  s = (await call(b, s, "post_key", T0, 1n, BigInt(T0))).state;
  s = (await call(a, s, "shuffle", T0, 0n, BigInt(T0))).state;
  s = (await call(b, s, "shuffle", T0, 1n, BigInt(T0))).state;
  await expect(call(a, s, "shares", T0, 1n, ten([0]))).rejects.toThrow(/does not match/);
});

test("the caller's clock must agree with the chain", async () => {
  const players = [player(), player()];
  const s = await seated(players);
  await expect(call(players[0]!, s, "start_deal", T0, BigInt(T0 + 1))).rejects.toThrow(/clock ahead/);
  await expect(call(players[0]!, s, "start_deal", T0, BigInt(T0 - 120))).rejects.toThrow(/clock behind/);
  await call(players[0]!, s, "start_deal", T0, BigInt(T0 - 119)); // inside the slack
});

test("a missed deadline aborts the deal and names the seat that owed the step", async () => {
  const players = Array.from({ length: 3 }, () => player());
  let s = await seated(players);
  s = (await call(players[0]!, s, "start_deal", T0, BigInt(T0))).state;
  await expect(call(players[0]!, s, "expire", T0 + 59)).rejects.toThrow(/deadline not reached/);

  // Keys phase: seat 1 never posts.
  let k = (await call(players[0]!, s, "post_key", T0, 0n, BigInt(T0))).state;
  k = (await call(players[2]!, k, "post_key", T0, 2n, BigInt(T0))).state;
  k = (await call(players[1]!, k, "expire", T0 + 60)).state;
  expect(ledger(k).phase).toBe(Phase.aborted);
  expect(ledger(k).offender).toBe(1n);
  await expect(call(players[0]!, k, "expire", T0 + 61)).rejects.toThrow(/nothing pending/);

  // Shuffle phase: the seat whose turn it is.
  for (let i = 0; i < 3; i++) s = (await call(players[i]!, s, "post_key", T0 + 5, BigInt(i), BigInt(T0 + 5))).state;
  s = (await call(players[0]!, s, "shuffle", T0 + 20, 0n, BigInt(T0 + 20))).state;
  expect(ledger(s).turn).toBe(1n);
  expect(ledger(s).deadline).toBe(BigInt(T0 + 20 + 240));
  s = (await call(players[2]!, s, "expire", T0 + 260)).state;
  expect(ledger(s).offender).toBe(1n);

  // An aborted deal can be restarted.
  s = (await call(players[2]!, s, "start_deal", T0 + 300, BigInt(T0 + 300))).state;
  expect(ledger(s).phase).toBe(Phase.keys);
  expect(ledger(s).deal_no).toBe(2n);
});
