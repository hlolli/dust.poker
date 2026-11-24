import * as L from "@midnightntwrk/ledger-v9";
import { ContractState as RuntimeState, createCircuitContext } from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger } from "../../contracts/build/queue/contract/index.js";
import { ledger as gameLedger } from "../../contracts/build/deal/contract/index.js";
import type { Profile } from "../ui/profiles.ts";
import { COIN_PUBLIC_KEY, keyMaterial, submitThrough, walletChain } from "./chain.ts";
import type { Wallet } from "./wallet.ts";
import { bytes, callTx, hex, isOurs } from "./ledger.ts";
import { deployTable, joinTable, publicPlayerKey, settled, submitPublicCall } from "./live.ts";
import { Phase, seatOf } from "../referee/rules.ts";
import { DRAW_SECONDS, drawRandomness, drawTables, drawTime } from "./draw.ts";
import templateUrl from "./public-queue.intent" with { type: "file" };

// A deployment contains a random nonce. Reusing this exact deployment makes the
// registry discoverable even by the first player on a new network. Only the outer
// fee-paying transaction is rebuilt. The queue has no maintenance authority.
export const QUEUE_ADDRESS = "db70eb39ce4bb87775a3c9794a1ea2c310350ccc690f57ceca9645e009555982";
const QUEUE_CIRCUITS = ["enter_queue", "announce_table"];
const ttl = () => new Date(Date.now() + 3_600_000);

export type QueueAction = "open" | "enter" | "wait" | "host" | "join" | "resume" | "finished";
export type QueueStatus = { action: QueueAction; message: string; round?: number; roster?: string[]; address?: string };
type Assignment = { address: string; roster: string[] };
type Ticket = { round: number; proposed?: string; claim?: Assignment & { until: number } };
type TicketStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class PublicQueue {
  private readonly chain;
  private readonly member;
  private readonly contract;
  private readonly storageKey;
  private checked = false;
  private draw?: { round: number; tables: string[][] };
  constructor(
    private readonly wallet: Wallet,
    private readonly profile: Profile,
    private readonly storage: TicketStore = localStorage,
  ) {
    this.chain = walletChain(wallet, QUEUE_ADDRESS);
    const secret = BigInt(profile.secret);
    this.member = publicPlayerKey(secret);
    this.contract = new Contract({ player_secret: (ctx) => [ctx.privateState, secret] });
    this.storageKey = `dust.poker/draw/${wallet.networkId}/${this.member}`;
  }

  private ticket(): Ticket | undefined {
    const raw = this.storage.getItem(this.storageKey);
    if (!raw) return;
    const ticket: Ticket = JSON.parse(raw);
    if (!Number.isSafeInteger(ticket.round) || ticket.round < 0) throw new Error("Invalid saved public draw.");
    return ticket;
  }

  private save(ticket: Ticket) {
    const current = this.ticket();
    if (current && current.round !== ticket.round) throw new Error("Another tab has selected a different draw.");
    this.storage.setItem(this.storageKey, JSON.stringify({ ...current, ...ticket }));
  }
  hasTicket() {
    return this.storage.getItem(this.storageKey) !== null;
  }
  async forget() {
    const ticket = this.ticket();
    if (ticket?.claim) {
      const state = await this.tableStatus(ticket.round, ticket.claim);
      if (state.action === "resume") throw new Error("Return to this table and cash out before leaving the draw.");
      if (state.action !== "finished" && state.time * 1000 < ticket.claim.until)
        throw new Error("A seat confirmation may still arrive. Check this draw again before leaving.");
    }
    if (JSON.stringify(this.ticket()) !== JSON.stringify(ticket))
      throw new Error("Another tab updated your draw. Check it again.");
    this.storage.removeItem(this.storageKey);
    this.draw = undefined;
  }

  async status(): Promise<QueueStatus> {
    const saved = this.ticket();
    // Funded players can get back to their money when the randomness relay is down.
    if (saved?.claim) {
      const state = await this.tableStatus(saved.round, saved.claim);
      if (state.action !== "join") return state;
    }
    const snap = await this.chain.snapshot();
    if (!snap.state)
      return {
        action: "open",
        message: "You’re the first here. Open the shared public queue on this network. Lace will ask for a network fee.",
      };
    if (!this.checked) {
      if (!(await isOurs(snap.state, keyMaterial.getVerifierKey, QUEUE_CIRCUITS)))
        throw new Error("Could not verify the public queue on this network.");
      this.checked = true;
    }
    const data = ledger(RuntimeState.deserialize(snap.state.serialize()).data);
    const current = Math.floor(snap.time / DRAW_SECONDS);
    const round = saved?.round ?? current;
    const r = BigInt(round);
    const joined = data.registered.member(r) && data.registered.lookup(r).member(bytes(this.member));
    if (!joined) {
      if (saved && round !== current)
        return {
          action: "finished",
          message: "Registration closed before your entry was confirmed. You can enter the next draw.",
        };
      return {
        action: "enter",
        round: current,
        message: "Enter the public draw. Lace pays the network fee. You buy in after you see your assignment.",
      };
    }
    if (!saved) this.save({ round });
    const count = Number(data.count.lookup(r));
    const end = (round + 1) * DRAW_SECONDS;
    if (snap.time < end)
      return {
        action: "wait",
        round,
        message: `${count} in the public draw. Registration closes at ${new Date(end * 1000).toLocaleTimeString()}. You can return in this browser.`,
      };
    if (count < 4)
      return {
        action: "finished",
        message: `Only ${count} entered. Four players are needed to draw two tables. No buy-in was taken.`,
      };
    if (snap.time < drawTime(round))
      return { action: "wait", round, message: "Registration closed. Waiting for the signed random draw." };
    if (this.draw?.round !== round) {
      const players = Array.from(data.entrants.lookup(r), ([, key]) => hex(key));
      if (players.length !== count) throw new Error("The public draw roster is incomplete.");
      this.draw = { round, tables: await drawTables(this.wallet.networkId, round, players, await drawRandomness(round)) };
    }
    const roster = this.draw.tables.find((table) => table.includes(this.member));
    if (!roster) throw new Error("The draw has no seat for this profile.");
    const host = roster[0]!;
    const proposed = data.proposals.member(r) ? data.proposals.lookup(r) : null;
    if (proposed?.member(bytes(host))) {
      const address = hex(proposed.lookup(bytes(host)));
      return this.tableStatus(round, { address, roster });
    }
    if (this.member === host)
      return {
        action: "host",
        round,
        roster,
        message: `You were drawn to open this ${roster.length}-player table. Lace will ask for its deployment and announcement fees.`,
      };
    return {
      action: "wait",
      round,
      message: `You drew a ${roster.length}-player table. Waiting for the drawn host to open it. You can return to this draw later.`,
    };
  }

  private async tableStatus(round: number, { address, roster }: Assignment): Promise<QueueStatus & { time: number }> {
    const { state, time } = await walletChain(this.wallet, address).snapshot();
    if (!state) throw new Error("The announced table could not be found. You can leave this draw.");
    const game = gameLedger(RuntimeState.deserialize(state.serialize()).data);
    const chair = roster.indexOf(this.member);
    if (chair < 0) throw new Error("Your profile is missing from this roster.");
    if (seatOf(game, BigInt(this.profile.secret)) === chair)
      return {
        action: "resume",
        round,
        address,
        roster,
        time,
        message: "Your seat is still at this table. Return to play or cash out.",
      };
    if (game.phase !== Phase.reserved || game.payout_address.size() !== BigInt(roster.length))
      return { action: "finished", time, message: "A chair has closed. You can enter another public draw." };
    if (
      game.seat_owner.member(BigInt(chair)) ||
      !game.payout_address.member(BigInt(chair)) ||
      hex(game.payout_address.lookup(BigInt(chair))) !== this.member
    )
      throw new Error("The announced table did not reserve your chair. You can leave this draw.");
    return {
      action: "join",
      round,
      address,
      roster,
      time,
      message: `Your ${roster.length}-player table is ready. Confirm your seat in Lace.`,
    };
  }

  async act(expected: QueueAction, say: (message: string) => void) {
    const state = await this.status();
    if (state.action !== expected) return;
    if (expected === "open") {
      const res = await fetch(new URL(templateUrl, import.meta.url));
      if (!res.ok) throw new Error("The public queue deployment could not be loaded.");
      const intent = L.Intent.deserialize("signature", "pre-proof", "pre-binding", new Uint8Array(await res.arrayBuffer()));
      const deploy = intent.actions[0];
      if (
        !(deploy instanceof L.ContractDeploy) ||
        deploy.address !== QUEUE_ADDRESS ||
        !(await isOurs(deploy.initialState, keyMaterial.getVerifierKey, QUEUE_CIRCUITS))
      )
        throw new Error("Invalid public queue deployment.");
      await submitThrough(
        this.wallet,
        L.Transaction.fromParts(this.wallet.networkId, undefined, undefined, L.Intent.new(ttl()).addDeploy(deploy)),
      );
      await settled(this.chain, (s) => s !== null, "opening the public queue");
      return;
    }
    if (expected === "wait" || expected === "finished") return;
    const round = state.round!;
    const r = BigInt(round);
    if (expected === "join" || expected === "resume") {
      // A submitted buy-in may outlive the page or arrive after an indexer timeout.
      return joinTable(this.wallet, this.profile, state.address!, 200n, state.roster!, {
        resumeOnly: expected === "resume",
        progress: say,
        beforeClaim: (expires) =>
          this.save({
            ...this.ticket(),
            round,
            claim: { address: state.address!, roster: state.roster!, until: expires.getTime() + 60_000 },
          }),
      });
    }
    let address: string | undefined;
    if (expected === "host") {
      address = this.ticket()?.proposed ?? (await deployTable(this.wallet, this.profile, say, state.roster!));
      this.save({ round, proposed: address });
    } else {
      // Save before the wallet hand-off so a delayed confirmation survives a reload.
      this.save({ round });
    }
    const circuitId = address ? "announce_table" : "enter_queue";
    const member = bytes(this.member);
    const confirmed = (q: ReturnType<typeof ledger>) =>
      address
        ? q.proposals.member(r) && q.proposals.lookup(r).member(member)
        : q.registered.member(r) && q.registered.lookup(r).member(member);
    const version = (q: ReturnType<typeof ledger>) =>
      address ? q.proposals.member(r) : q.count.member(r) ? q.count.lookup(r) : 0n;
    await submitPublicCall(
      this.chain,
      circuitId,
      async (snap) => {
        if (!snap.state) throw new Error("The public queue is unavailable.");
        const state = RuntimeState.deserialize(snap.state.serialize());
        const data = ledger(state.data);
        if (confirmed(data)) return;
        const previous = version(data);
        const ctx = createCircuitContext({
          circuitId,
          contractAddress: QUEUE_ADDRESS,
          coinPublicKeyOrZswapState: COIN_PUBLIC_KEY,
          contractState: state,
          privateState: {},
          time: snap.time,
        });
        const run = address
          ? await this.contract.circuits.announce_table(ctx, r, bytes(address))
          : await this.contract.circuits.enter_queue(ctx, r);
        const tx = callTx(this.wallet.networkId, run, snap.state, snap.params, ttl());
        return {
          tx,
          result(current) {
            if (!current.state) throw new Error("The public queue is unavailable.");
            const q = ledger(RuntimeState.deserialize(current.state.serialize()).data);
            if (confirmed(q)) return "done";
            if (!address && current.time >= (round + 1) * DRAW_SECONDS)
              throw new Error("Registration closed. Check this draw and try the next one.");
            return version(q) !== previous ? "stale" : "pending";
          },
        };
      },
      say,
    );
  }
}
