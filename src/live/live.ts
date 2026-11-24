// A Live table's first transactions, through the player's wallet: deploying a table, and
// joining one. The circuit runs here against the state the chain reports, the wallet's prover
// proves it (ADR 0005: the player's own software), and the wallet adds the buy-in, the bond
// and the fee, signs, and submits. Import only after the runtime's and the ledger's wasm are
// ready. The deal itself is played by the Live referee (referee.ts) over the same chain.
import { CompactTypeJubjubPoint, ContractState as RuntimeContractState, createCircuitContext, createConstructorContext, dummyContractAddress, ecMulGenerator, persistentHash } from "@midnight-ntwrk/compact-runtime";
import * as L from "@midnightntwrk/ledger-v9";
import { ledger } from "../../contracts/build/deal/contract/index.js";
import { Contract as Reservation } from "../../contracts/build/public-seat/contract/index.js";
import { Seat } from "../referee/contract.ts";
import { CIRCUITS, seatOf } from "../referee/rules.ts";
import type { Profile } from "../ui/profiles.ts";
import { type Chain, type Snapshot, callOn, COIN_PUBLIC_KEY, keyMaterial, submitThrough, walletChain } from "./chain.ts";
import { bytes, callTx, deployInParts, hex, isOurs, type VerifierKeys } from "./ledger.ts";
import type { KeyStore } from "./referee.ts";
import type { Wallet } from "./wallet.ts";

export { L as ledger, walletChain };

const HOUR = 3_600_000;
/** The table's asset: Night, until a test token is chosen (dealing.md, Stakes). */
export const ASSET = () => bytes(L.nativeToken().raw);

/** The player at a Live table: the profile's name and its secret, which is the identity the seat owner's point derives from. */
export const you = (profile: Profile) => new Seat(profile.name, BigInt(profile.secret));

/** Polls the chain until the table's state satisfies `ok`; a few blocks at most. */
export async function settled(chain: Chain, ok: (state: L.ContractState | null) => boolean, what: string, ms = 180_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (ok((await chain.snapshot()).state)) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${what}: the chain did not show it in time`);
}

/** Rebuild only when an indexed change makes the previous call impossible. Returning
 *  undefined from build means the requested change has already landed (another tab). */
export async function submitPublicCall(chain: Chain, what: string, build: (snap: Snapshot) => Promise<{
  tx: L.UnprovenTransaction;
  result: (current: Snapshot) => "pending" | "stale" | "done";
} | undefined>, progress?: (message: string) => void) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const call = await build(await chain.snapshot());
    if (!call) return;
    try {
      await chain.submit(call.tx);
    } catch (error) {
      const result = call.result(await chain.snapshot());
      if (result === "done") return;
      if (result !== "stale" || !(error instanceof Error) || !error.message.includes("partialSuccess")) throw error;
      // A wallet can report a rejected stale transaction before polling starts.
    }
    const deadline = Date.now() + 180_000;
    for (;;) {
      const result = call.result(await chain.snapshot());
      if (result === "done") return;
      if (result === "stale") break;
      if (Date.now() >= deadline) throw new Error(`${what} is still unconfirmed. Check the draw again.`);
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    progress?.("Another player confirmed first. Your wallet may ask you to confirm the updated transaction.");
  }
  throw new Error("The draw is busy. Check your entry and try again.");
}

/**
 * Deploys a table; returns its address. Nothing to prove in a deploy, but the wallet balances the
 * fee. The deploy comes in parts (ledger.ts, deployInParts), each waited for before the next, and
 * the address is handed back once the last part has locked the circuits.
 */
export const publicPlayerKey = (secret: bigint) => hex(persistentHash(CompactTypeJubjubPoint, ecMulGenerator(secret)));
export const PUBLIC_CIRCUITS = CIRCUITS.map(name => name === "join" ? "claim_seat" : name);

export async function tableOpening(seat: Seat, roster?: readonly string[]) {
  const { currentContractState: state } = await seat.contract.initialState(createConstructorContext({}, COIN_PUBLIC_KEY), ASSET());
  if (!roster) return state;
  if (roster.length < 2 || roster.length > 6 || new Set(roster).size !== roster.length || roster.some(k => !/^[0-9a-f]{64}$/.test(k))) throw new Error("Invalid public table roster.");
  const reservation = new Reservation({ player_secret: ctx => [ctx.privateState, seat.secret] });
  for (const [i, key] of roster.entries()) {
    const ctx = createCircuitContext({ circuitId: "reserve_seat", contractAddress: dummyContractAddress(), coinPublicKeyOrZswapState: COIN_PUBLIC_KEY, contractState: state, privateState: {} });
    const run = await reservation.circuits.reserve_seat(ctx, BigInt(i), bytes(key));
    state.data = run.context.callContext.currentQueryContext.state;
  }
  return state;
}

export async function deployTable(w: Wallet, profile: Profile, progress?: (message: string) => void, roster?: readonly string[]): Promise<string> {
  const constructed = await tableOpening(you(profile), roster);
  const { params } = await walletChain(w, "00".repeat(32)).snapshot();
  const plan = await deployInParts(w.networkId, constructed, keyMaterial.getVerifierKey, params, new Date(Date.now() + HOUR), 0.6, roster ? PUBLIC_CIRCUITS : CIRCUITS);
  const chain = walletChain(w, plan.address);
  progress?.(`Confirm table deployment 1 of ${1 + plan.updates.length} in the wallet.`);
  await submitThrough(w, plan.deploy);
  await settled(chain, (s) => s !== null, "the deploy");
  for (const [i, update] of plan.updates.entries()) {
    progress?.(`Confirm table deployment ${i + 2} of ${1 + plan.updates.length} in the wallet.`);
    await submitThrough(w, update);
    await settled(chain, (s) => s !== null && s.maintenanceAuthority.counter > BigInt(i), `update ${i + 1} of ${plan.updates.length}`);
  }
  return plan.address;
}

/** Joins the table on `chain` with `buy` chips; the chain's balancing adds buy plus bond of the
 *  table's asset. A player already seated there (a reload, another tab) takes their seat back
 *  without a transaction. With `keys`, refuses a table whose circuits are not the ones we built,
 *  whose circuits someone could still change, or whose locked opening was not the empty
 *  constructor state. Returns the seat. */
type Admission = { beforeClaim?: (expires: Date) => void; resumeOnly?: boolean; progress?: (message: string) => void };
export async function joinOn(chain: Chain, seat: Seat, payout: Uint8Array, buy = 200n, keys?: VerifierKeys, roster?: readonly string[], admission?: Admission): Promise<number> {
  const snap = await chain.snapshot();
  const assigned = roster?.indexOf(publicPlayerKey(seat.secret));
  if (roster && (!keys || assigned === -1)) throw new Error("This public table has no verified seat for you.");
  if (snap.state) {
    if (keys && !(await isOurs(snap.state, keys, roster ? PUBLIC_CIRCUITS : CIRCUITS))) throw new Error("Not a dust.poker table: its circuits are not the ones this site plays, or they can still be changed.");
    if (keys) await verifyOpening(chain, seat, keys, roster);
    const held = seatOf(ledger(RuntimeContractState.deserialize(snap.state.serialize()).data), seat.secret);
    if (held >= 0) return (seat.index = held);
  }
  let proposed: bigint;
  if (assigned !== undefined) {
    if (!snap.state || admission?.resumeOnly) throw new Error("Your funded seat could not be found.");
    const reservation = new Reservation({ player_secret: c => [c.privateState, seat.secret] });
    await submitPublicCall(chain, "Your seat", async fresh => {
      if (!fresh.state) throw new Error("The assigned table is unavailable.");
      const state = RuntimeContractState.deserialize(fresh.state.serialize());
      const game = ledger(state.data);
      if (seatOf(game, seat.secret) === assigned) return;
      const previous = game.seat_owner.size();
      const ctx = createCircuitContext({ circuitId: "claim_seat", contractAddress: chain.address, coinPublicKeyOrZswapState: COIN_PUBLIC_KEY, contractState: state, privateState: {} });
      const run = await reservation.circuits.claim_seat(ctx, BigInt(assigned), payout, buy);
      const expires = new Date(Date.now() + HOUR);
      const tx = callTx(chain.network, run, fresh.state, fresh.params, expires);
      admission?.beforeClaim?.(expires);
      return { tx, result(current) {
        if (!current.state) throw new Error("The assigned table is unavailable.");
        const after = ledger(RuntimeContractState.deserialize(current.state.serialize()).data);
        if (seatOf(after, seat.secret) === assigned) return "done";
        if (after.payout_address.size() !== BigInt(roster!.length)) throw new Error("A drawn player withdrew before the table opened.");
        return after.seat_owner.size() !== previous ? "stale" : "pending";
      } };
    }, admission?.progress);
    return (seat.index = assigned);
  } else {
    const { tx, result } = await callOn(chain, snap, seat, "join", [payout, buy]);
    proposed = BigInt(Number(result));
    await chain.submit(tx);
  }
  await settled(chain, (state) => {
    if (!state) return false;
    const l = ledger(RuntimeContractState.deserialize(state.serialize()).data);
    const held = seatOf(l, seat.secret);
    if (held >= 0) {
      seat.index = held;
      return true;
    }
    if (l.seat_owner.member(proposed)) throw new Error("Another player took that seat first. Choose Take a seat again for the next available seat.");
    return false;
  }, "the join");
  return seat.index;
}

/** Verifier keys authenticate calls, not constructor data. Establish the empty, immutable
 *  starting point so invented stacks or a substituted fresh deck cannot pass the join gate. */
async function verifyOpening(chain: Chain, seat: Seat, keys: VerifierKeys, roster?: readonly string[]): Promise<void> {
  const opened = await chain.opening?.();
  const expected = await tableOpening(seat, roster);
  // Normalize the data into otherwise empty ledger states; maintenance counters and keys
  // differ during installation, and charged read/write accounting is not contract data.
  const encoded = (state: L.StateValue) => {
    const holder = new L.ContractState();
    holder.data = new L.ChargedState(state);
    return holder.serialize();
  };
  const data = encoded(L.StateValue.decode(expected.data.state.encode()));
  const actual = opened && encoded(opened.data.state);
  if (!opened || !actual || opened.balance.size !== 0 || actual.length !== data.length || actual.some((b, i) => b !== data[i]) || !(await isOurs(opened, keys, roster ? PUBLIC_CIRCUITS : CIRCUITS))) {
    throw new Error("Not a dust.poker table: its empty, immutable opening could not be verified.");
  }
}

/** Joins the table at `address` through the wallet. Returns the chain to play on, your seat, and where its keys are kept. */
export async function joinTable(w: Wallet, profile: Profile, address: string, buy = 200n, roster?: readonly string[], admission?: Admission): Promise<{ chain: Chain; seat: Seat; store: KeyStore }> {
  const chain = walletChain(w, address);
  const seat = you(profile);
  await joinOn(chain, seat, w.payout, buy, keyMaterial.getVerifierKey, roster, admission);
  return { chain, seat, store: browserKeyStore(`dust.poker/keys/${profile.id}/${address}`) };
}

/** Deck keys in local storage, one entry per profile and table. */
export function browserKeyStore(key: string): KeyStore {
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const k = JSON.parse(raw) as { dealNo: string; x: string; nextX: string };
        return { dealNo: BigInt(k.dealNo), x: BigInt(k.x), nextX: BigInt(k.nextX) };
      } catch {
        return null;
      }
    },
    save(k) {
      localStorage.setItem(key, JSON.stringify({ dealNo: String(k.dealNo), x: String(k.x), nextX: String(k.nextX) }));
    },
  };
}
