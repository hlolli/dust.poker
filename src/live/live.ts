// A Live table's first transactions, through the player's wallet: deploying a table, and
// joining one. The circuit runs here against the state the chain reports, the wallet's prover
// proves it (ADR 0005: the player's own software), and the wallet adds the buy-in, the bond
// and the fee, signs, and submits. Import only after the runtime's and the ledger's wasm are
// ready. The deal itself is played by the Live referee (referee.ts) over the same chain.
import { ContractState as RuntimeContractState, createConstructorContext } from "@midnight-ntwrk/compact-runtime";
import * as L from "@midnightntwrk/ledger-v9";
import { ledger } from "../../contracts/build/deal/contract/index.js";
import { Seat } from "../referee/contract.ts";
import { seatOf } from "../referee/rules.ts";
import type { Profile } from "../ui/profiles.ts";
import { type Chain, callOn, COIN_PUBLIC_KEY, keyMaterial, submitThrough, walletChain } from "./chain.ts";
import { bytes, deployable, deployTx } from "./ledger.ts";
import type { KeyStore } from "./referee.ts";
import type { Wallet } from "./wallet.ts";

export { L as ledger, walletChain };

const HOUR = 3_600_000;
/** The table's asset: Night, until a test token is chosen (dealing.md, Stakes). */
export const ASSET = () => bytes(L.nativeToken().raw);

/** The player at a Live table: the profile's name and its secret, which is the identity the seat owner's point derives from. */
export const you = (profile: Profile) => new Seat(profile.name, BigInt(profile.secret));

/** Deploys a table; returns its address. Nothing to prove in a deploy, but the wallet balances the fee. */
export async function deployTable(w: Wallet, profile: Profile): Promise<string> {
  const constructed = await you(profile).contract.initialState(createConstructorContext({}, COIN_PUBLIC_KEY), ASSET());
  const { address, tx } = deployTx(w.networkId, await deployable(constructed.currentContractState, keyMaterial.getVerifierKey), new Date(Date.now() + HOUR));
  await submitThrough(w, tx);
  return address;
}

/** Joins the table on `chain` with `buy` chips; the chain's balancing adds buy plus bond of the
 *  table's asset. A player already seated there (a reload, another tab) takes their seat back
 *  without a transaction. Returns the seat. */
export async function joinOn(chain: Chain, seat: Seat, payout: Uint8Array, buy = 200n): Promise<number> {
  const snap = await chain.snapshot();
  if (snap.state) {
    const held = seatOf(ledger(RuntimeContractState.deserialize(snap.state.serialize()).data), seat.secret);
    if (held >= 0) return (seat.index = held);
  }
  const { tx, result } = await callOn(chain, snap, seat, "join", [payout, buy]);
  await chain.submit(tx);
  seat.index = Number(result);
  return seat.index;
}

/** Joins the table at `address` through the wallet. Returns the chain to play on, your seat, and where its keys are kept. */
export async function joinTable(w: Wallet, profile: Profile, address: string, buy = 200n): Promise<{ chain: Chain; seat: Seat; store: KeyStore }> {
  const chain = walletChain(w, address);
  const seat = you(profile);
  await joinOn(chain, seat, w.payout, buy);
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
