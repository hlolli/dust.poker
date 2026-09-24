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
export async function deployTable(w: Wallet, profile: Profile): Promise<string> {
  const constructed = await you(profile).contract.initialState(createConstructorContext({}, COIN_PUBLIC_KEY), ASSET());
  const { params } = await walletChain(w, "00".repeat(32)).snapshot();
  const plan = await deployInParts(w.networkId, constructed.currentContractState, keyMaterial.getVerifierKey, params, new Date(Date.now() + HOUR));
  const chain = walletChain(w, plan.address);
  await submitThrough(w, plan.deploy);
  await settled(chain, (s) => s !== null, "the deploy");
  for (const [i, update] of plan.updates.entries()) {
    await submitThrough(w, update);
    await settled(chain, (s) => s !== null && s.maintenanceAuthority.counter > BigInt(i), `update ${i + 1} of ${plan.updates.length}`);
  }
  return plan.address;
}

/** Joins the table on `chain` with `buy` chips; the chain's balancing adds buy plus bond of the
 *  table's asset. A player already seated there (a reload, another tab) takes their seat back
 *  without a transaction. With `keys`, refuses a table whose circuits are not the ones we built,
 *  or whose circuits someone could still change. Returns the seat. */
export async function joinOn(chain: Chain, seat: Seat, payout: Uint8Array, buy = 200n, keys?: VerifierKeys): Promise<number> {
  const snap = await chain.snapshot();
  if (snap.state) {
    if (keys && !(await isOurs(snap.state, keys, CIRCUITS))) throw new Error("Not a dust.poker table: its circuits are not the ones this site plays, or they can still be changed.");
    const held = seatOf(ledger(RuntimeContractState.deserialize(snap.state.serialize()).data), seat.secret);
    if (held >= 0) return (seat.index = held);
  }
  const { tx, result } = await callOn(chain, snap, seat, "join", [payout, buy]);
  await chain.submit(tx);
  seat.index = Number(result);
  // Until the chain shows the seat as ours, nothing is joined: another player's join in the
  // same block would have taken the seat this one was computed for.
  await settled(chain, (s) => s !== null && seatOf(ledger(RuntimeContractState.deserialize(s.serialize()).data), seat.secret) === seat.index, "the join");
  return seat.index;
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
