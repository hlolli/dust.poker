import { snapshot } from "../live/indexer.ts";
import { loadLive } from "../live/load.ts";
import { NETWORKS, PREVIEW_INDEXER, type Wallet } from "../live/wallet.ts";
import { profiles } from "./profiles.ts";
import { inviteCopy } from "./table-invite.ts";

/** Viewing the lobby only reads the indexer. The menu owns the explicit Join table action. */
export function inviteLobby(panel: HTMLElement, network: string, address: string) {
  const join = panel.querySelector<HTMLButtonElement>(".lobby-join")!;
  const seats = panel.querySelector<HTMLOListElement>(".lobby-seats")!;
  const summary = panel.querySelector<HTMLElement>(".lobby-count")!;
  const cost = panel.querySelector<HTMLElement>(".lobby-cost")!;
  const valid = NETWORKS.includes(network) && /^[a-f0-9]{64}$/.test(address);
  panel.querySelector<HTMLElement>(".lobby-network")!.textContent = network;
  panel.querySelector<HTMLElement>(".lobby-address")!.textContent = address;
  if (valid) panel.querySelector(".lobby-share")!.append(inviteCopy(network, address));
  let wallet: Wallet | null = null;
  let busy = false;
  let roster: (string | null)[] | undefined;
  let playerKey: typeof import("../live/live.ts").publicPlayerKey | undefined;
  let pending: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function render() {
    const saved = profiles();
    const names = new Map<string, string>();
    let own: string | undefined;
    for (const p of saved.list) {
      if (!playerKey) break;
      const key = playerKey(BigInt(p.secret));
      names.set(key, p.name);
      if (p.id === saved.active) own = key;
    }
    const returning = !!own && !!roster?.includes(own);
    join.disabled = busy || !wallet || !roster || (!returning && !roster.includes(null));
    cost.textContent = returning ? "Your seat is here. Rejoining uses your existing stack." : "Buy-in 200 STAR · Refundable bond 200 STAR";
    seats.hidden = !roster;
    seats.replaceChildren(...(roster ?? []).map((key, i) => {
      const row = document.createElement("li");
      const chair = document.createElement("span");
      chair.textContent = `Seat ${i + 1}`;
      const player = document.createElement("strong");
      player.textContent = key ? (names.get(key) ?? `Player ${key.slice(0, 8)}`) + (key === own ? " (you)" : "") : "Open";
      row.classList.toggle("occupied", !!key);
      row.append(chair, player);
      return row;
    }));
  }
  function stop() {
    pending?.abort();
    clearTimeout(timer);
  }
  function setWallet(next: Wallet | null) {
    stop();
    wallet = next;
    roster = undefined;
    render();
    if (!valid) {
      summary.textContent = "Invalid invitation. Ask the host for a fresh link.";
      return;
    }
    const uri = wallet?.config.indexerUri ?? (network === "preview" ? PREVIEW_INDEXER :
      network === "undeployed" ? "http://127.0.0.1:8088/api/v4/graphql" : undefined);
    if (!uri) {
      summary.textContent = "Connect Lace to see the seats through your Preprod indexer.";
      return;
    }
    summary.textContent = "Checking seats…";
    const controller = new AbortController();
    pending = controller;
    const read = async () => {
      try {
        const [snap, live] = await Promise.all([snapshot(uri, address, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)])), loadLive()]);
        if (controller.signal.aborted) return;
        if (!snap.state) throw new Error("Table not found on this network. Check the invite with the host.");
        roster = live.inviteSeats(snap.state);
        playerKey = live.publicPlayerKey;
        const count = roster.filter(Boolean).length;
        summary.textContent = count === 6 ? "6 of 6 seated · Table full" : `${count} of 6 seated`;
      } catch (error) {
        if (controller.signal.aborted) return;
        roster = undefined;
        summary.textContent = error instanceof Error ? error.message : "Could not read this table.";
      }
      render();
      timer = setTimeout(() => void read(), 10_000);
    };
    void read();
  }
  return { join, valid, setWallet, render, stop, setBusy(value: boolean) { busy = value; render(); } };
}
