// A Live table's first transactions, through the player's wallet: deploying a table, and
// joining one. The circuit runs here against the state the chain reports, the wallet's prover
// proves it (ADR 0005: the player's own software), and the wallet adds the buy-in, the bond
// and the fee, signs, and submits. Import only after the runtime's and the ledger's wasm are
// ready. The deal itself is played by the Live referee (referee.ts) over the same chain.
import { ContractState as RuntimeContractState, createConstructorContext } from "@midnight-ntwrk/compact-runtime";
import * as L from "@midnightntwrk/ledger-v9";
import { ledger } from "../../contracts/build/deal/contract/index.js";
import { Seat } from "../referee/contract.ts";
import { CIRCUITS, seatOf } from "../referee/rules.ts";
import type { Profile } from "../ui/profiles.ts";
import { type Chain, callOn, COIN_PUBLIC_KEY, keyMaterial, submitThrough, walletChain } from "./chain.ts";
import { bytes, deployInParts, isOurs, type VerifierKeys } from "./ledger.ts";
import type { KeyStore } from "./referee.ts";
import type { Wallet } from "./wallet.ts";

export { L as ledger, walletChain };

const HOUR = 3_600_000;
/** The table's asset: Night, until a test token is chosen (dealing.md, Stakes). */
export const ASSET = () => bytes(L.nativeToken().raw);

/** The player at a Live table: the profile's name and its secret, which is the identity the seat owner's point derives from. */
export const you = (profile: Profile) => new Seat(profile.name, BigInt(profile.secret));

/** Polls the chain until the table's state satisfies `ok`; a few blocks at most. */
async function settled(chain: Chain, ok: (state: L.ContractState | null) => boolean, what: string, ms = 180_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (ok((await chain.snapshot()).state)) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${what}: the chain did not show it in time`);
}

/**
 * Deploys a table; returns its address. Nothing to prove in a deploy, but the wallet balances the
 * fee. The deploy comes in parts (ledger.ts, deployInParts), each waited for before the next, and
 * the address is handed back once the last part has locked the circuits.
 */
export async function deployTable(w: Wallet, profile: Profile, progress?: (message: string) => void): Promise<string> {
  const constructed = await you(profile).contract.initialState(createConstructorContext({}, COIN_PUBLIC_KEY), ASSET());
  const { params } = await walletChain(w, "00".repeat(32)).snapshot();
  const plan = await deployInParts(w.networkId, constructed.currentContractState, keyMaterial.getVerifierKey, params, new Date(Date.now() + HOUR));
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
export async function joinOn(chain: Chain, seat: Seat, payout: Uint8Array, buy = 200n, keys?: VerifierKeys): Promise<number> {
  const snap = await chain.snapshot();
  if (snap.state) {
    if (keys && !(await isOurs(snap.state, keys, CIRCUITS))) throw new Error("Not a dust.poker table: its circuits are not the ones this site plays, or they can still be changed.");
    if (keys) await verifyOpening(chain, seat, keys);
    const held = seatOf(ledger(RuntimeContractState.deserialize(snap.state.serialize()).data), seat.secret);
    if (held >= 0) return (seat.index = held);
  }
  const { tx, result } = await callOn(chain, snap, seat, "join", [payout, buy]);
  const proposed = BigInt(Number(result));
  await chain.submit(tx);
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
async function verifyOpening(chain: Chain, seat: Seat, keys: VerifierKeys): Promise<void> {
  const opened = await chain.opening?.();
  const expected = await seat.contract.initialState(createConstructorContext({}, COIN_PUBLIC_KEY), ASSET());
  // Normalize the data into otherwise empty ledger states; maintenance counters and keys
  // differ during installation, and charged read/write accounting is not contract data.
  const encoded = (state: L.StateValue) => {
    const holder = new L.ContractState();
    holder.data = new L.ChargedState(state);
    return holder.serialize();
  };
  const data = encoded(L.StateValue.decode(expected.currentContractState.data.state.encode()));
  const actual = opened && encoded(opened.data.state);
  if (!opened || !actual || opened.balance.size !== 0 || actual.length !== data.length || actual.some((b, i) => b !== data[i]) || !(await isOurs(opened, keys, CIRCUITS))) {
    throw new Error("Not a dust.poker table: its empty, immutable opening could not be verified.");
  }
}

/** Joins the table at `address` through the wallet. Returns the chain to play on, your seat, and where its keys are kept. */
export async function joinTable(w: Wallet, profile: Profile, address: string, buy = 200n): Promise<{ chain: Chain; seat: Seat; store: KeyStore }> {
  const chain = walletChain(w, address);
  const seat = you(profile);
  await joinOn(chain, seat, w.payout, buy, keyMaterial.getVerifierKey);
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
