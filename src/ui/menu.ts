import { setFor } from "../scene/lounge-score.ts";
import type { Chain } from "../live/chain.ts";
import type { KeyStore } from "../live/referee.ts";
import type { PublicQueue, QueueStatus } from "../live/public-queue.ts";
import type { Seat } from "../referee/contract.ts";
import { MODELS } from "../scene/models.ts";
import { checkIndexer } from "../live/indexer.ts";
import { loadLive } from "../live/load.ts";
import { inviteLobby } from "./invite-lobby.ts";
import { connect, installed, NETWORKS, network as asked, type Wallet } from "../live/wallet.ts";
import { activate, activeProfile, createProfile, type Profile, profiles, removeProfile, updateProfile } from "./profiles.ts";

/** What the menu resolves with: the Practice table, or a Live one you have a seat at. */
export type Entry = { profile: Profile; mode: "practice" } | { profile: Profile; mode: "live"; access: "invite" | "draw"; chain: Chain; seat: Seat; store: KeyStore };

export function showMenu(): Promise<Entry> {
  return new Promise((resolve) => {
    const el = document.querySelector<HTMLElement>("main.menu")!;
    let lobby: ReturnType<typeof inviteLobby> | undefined;
    el.querySelector(".network")!.innerHTML = NETWORKS.map(n =>
      `<label class="ticket"><input type="radio" name="network" value="${n}" /><span>${n}</span></label>`).join("");

    // The bandstand line: what the house band is playing this hour, by the UTC clock.
    const KEYS = ["C", "D flat", "D", "E flat", "E", "F", "F sharp", "G", "A flat", "A", "B flat", "B"];
    const bandstand = el.querySelector<HTMLParagraphElement>(".bandstand")!;
    const tonight = () => {
      const set = setFor(new Date().getUTCHours());
      const band = ["bass", set.ride && "brushes", set.piano && "piano", set.vibes && "vibes"].filter(Boolean).join(", ");
      const feel = set.feel === "swing" ? (set.tempo < 100 ? "medium swing" : "uptempo swing")
        : { ballad: "a ballad", bossa: "bossa nova", blues: "twelve-bar blues" }[set.feel];
      bandstand.textContent = `On the bandstand this hour: set ${set.hour + 1} of 24, ${feel} in ${KEYS[set.key]}, ${set.tempo} to the minute, ${band}.`;
    };
    tonight();
    const bandTimer = setInterval(tonight, 60_000);

    // ---- Profiles ---------------------------------------------------------------------------
    const plates = el.querySelector<HTMLDivElement>(".plates")!;
    const go = el.querySelector<HTMLButtonElement>(".go")!;
    const editLook = async (initial?: Pick<Profile, "name" | "look">) => {
      if (el.inert) return null;
      const opener = document.activeElement;
      el.inert = true;
      try {
        const { showCreator } = await import("./creator.ts");
        return await showCreator(initial);
      } finally {
        el.inert = false;
        if (opener instanceof HTMLElement) opener.focus({ preventScroll: true });
      }
    };
    const newProfile = async () => {
      const made = await editLook();
      return made ? createProfile(made.name, made.look) : null;
    };
    const renderProfiles = () => {
      const { active, list } = profiles();
      const add = document.createElement("button");
      add.type = "button";
      add.className = "plate add";
      add.textContent = list.length ? "+ another" : "+ your name";
      add.onclick = async () => {
        await newProfile();
        renderProfiles();
      };
      plates.replaceChildren(
        ...list.map((p) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = `plate${p.id === active ? " active" : ""}`;
          b.title = p.id === active ? "Change your look" : MODELS[p.look.model]?.label ?? "";
          b.onclick = async () => {
            if (p.id !== active) activate(p.id);
            else {
              // The plate in use again: back to the creator, keeping the identity.
              const changed = await editLook({ name: p.name, look: p.look });
              if (changed) updateProfile(p.id, changed.name, changed.look);
            }
            renderProfiles();
          };
          const name = document.createElement("span");
          name.textContent = p.name;
          const x = document.createElement("span");
          x.className = "remove";
          x.textContent = "×";
          x.title = "Take this plate down";
          x.onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Take down "${p.name}"? The identity Live tables know them by goes with it.`)) removeProfile(p.id);
            renderProfiles();
          };
          b.append(name, x);
          return b;
        }),
        add,
      );
      lobby?.render();
    };
    renderProfiles();

    // ---- Practice ---------------------------------------------------------------------------
    const leave = (entry: Entry) => {
      clearInterval(bandTimer);
      lobby?.stop();
      resetDraw();
      el.remove();
      resolve(entry);
    };
    go.disabled = false;
    go.onclick = async () => {
      const profile = activeProfile() ?? await newProfile();
      if (profile) leave({ profile, mode: "practice" });
    };

    // ---- Live -------------------------------------------------------------------------------
    const live = el.querySelector<HTMLElement>(".live")!;
    const status = el.querySelector<HTMLSpanElement>(".status")!;
    const connectButton = el.querySelector<HTMLButtonElement>(".connect")!;
    connectButton.disabled = false;
    const network = el.querySelector<HTMLDivElement>(".network")!;
    const invites = el.querySelector<HTMLDetailsElement>(".invites")!;
    const publicSeating = el.querySelector<HTMLElement>(".public-seating")!;
    const findSeat = el.querySelector<HTMLButtonElement>(".find-seat")!;
    const forget = el.querySelector<HTMLButtonElement>(".forget-draw")!;
    const drawStatus = el.querySelector<HTMLElement>(".draw-status")!;
    let queue: PublicQueue | undefined;
    let queueProfile: string | undefined;
    let displayed: QueueStatus | undefined;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const resetDraw = () => {
      clearTimeout(poll);
      queue = undefined;
      displayed = undefined;
      queueProfile = undefined;
      findSeat.textContent = "Find a public seat";
      forget.hidden = true;
      drawStatus.textContent = "Anyone can enter. A random draw picks your opponents.";
    };
    const refreshDraw = async (q: PublicQueue) => {
      clearTimeout(poll);
      try {
        const next = await q.status();
        if (queue !== q) return;
        if (activeProfile()?.id !== queueProfile) { resetDraw(); return; }
        displayed = next;
        drawStatus.textContent = next.message;
        findSeat.textContent = { open: "Open the public queue", enter: "Enter the draw", wait: "Check draw", host: "Open assigned table", join: "Take drawn seat", resume: "Return to table", finished: "Find another draw" }[next.action];
        forget.hidden = next.action !== "wait" && next.action !== "host" && next.action !== "join";
        if (next.action === "wait") poll = setTimeout(() => void refreshDraw(q), 10_000);
      } catch (error) {
        if (queue === q) {
          displayed = undefined;
          findSeat.textContent = "Check public draw";
          forget.hidden = !q.hasTicket();
          drawStatus.textContent = error instanceof Error ? error.message : String(error);
        }
      }
    };
    forget.onclick = () => withLive("Leaving the draw", async (_, _wallet, profile) => {
      if (queueProfile === profile.id) await queue?.forget();
      resetDraw();
      return "You left this draw. Your entry in the closed roster stays fixed.";
    });
    const funding = el.querySelector<HTMLElement>(".funding")!;
    const address = el.querySelector<HTMLInputElement>("input[name=table]")!;
    const params = new URLSearchParams(location.search);
    address.value = params.get("table") ?? "";
    invites.open = Boolean(address.value);
    if (!location.hash && !params.has("table") && params.has("network")) {
      el.querySelector(activeProfile() ? "#live-table" : ".profiles")!.scrollIntoView();
    }
    let selected = asked();
    let wallet: Wallet | null = null;
    const say = (s: string) => (status.textContent = s);
    const fail = (e: unknown) => say(typeof e === "object" && e !== null && "message" in e ? String(e.message) : String(e));
    const lock = (busy: boolean) => {
      for (const control of live.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) control.disabled = busy;
      plates.inert = busy;
      go.disabled = busy;
      lobby?.setBusy(busy);
    };
    const pageAddress = (tableAddress: string) => {
      const url = new URL(location.href);
      url.searchParams.set("network", selected);
      if (tableAddress) url.searchParams.set("table", tableAddress);
      else url.searchParams.delete("table");
      history.replaceState(null, "", url);
    };
    for (const radio of network.querySelectorAll<HTMLInputElement>("input")) radio.checked = radio.value === selected;
    connectButton.onclick = async () => {
      const [found] = installed();
      if (!found) return say("No Midnight wallet in this browser. Install Lace, then reload.");
      say(`Confirm ${selected} in ${found.name}.`);
      lock(true);
      try {
        const w = await connect(found, selected);
        say(`Checking the ${selected} indexer…`);
        await checkIndexer(w.config.indexerUri, w.config.indexerWsUri);
        wallet = w;
        Object.assign(window, { __wallet: w });
        live.classList.remove("unlit");
        connectButton.hidden = true;
        invites.hidden = !!lobby;
        publicSeating.hidden = !!lobby;
        lobby?.setWallet(w);
        say(`${w.name} on ${selected}. A seat costs 200 STAR plus a 200 STAR bond. Transactions use tDUST.`);
        void w.api.getDustBalance?.().then(({ balance, cap }) => {
          if (wallet !== w || balance !== 0n) return;
          funding.textContent = cap > 0n
            ? "Lace reported zero spendable tDUST at connection. Wait for tDUST to accrue before starting."
            : "Lace reported zero tDUST at connection. Fund its unshielded address from the faucet and choose Generate tDUST in Lace.";
          funding.hidden = false;
        }).catch(() => {});
      } catch (error) {
        fail(error);
        if (/mismatch/i.test(status.textContent ?? "")) say(`Switch ${found.name} to ${selected}, then reconnect.`);
      } finally {
        lock(false);
      }
    };
    network.onchange = (e) => {
      selected = (e.target as HTMLInputElement).value;
      wallet = null;
      Reflect.deleteProperty(window, "__wallet");
      address.value = "";
      pageAddress("");
      live.classList.add("unlit");
      invites.hidden = true;
      invites.open = false;
      publicSeating.hidden = true;
      resetDraw();
      funding.hidden = true;
      connectButton.hidden = false;
      say(`Select ${selected} in Lace, then connect.`);
    };
    const withLive = async (what: string, run: (live: typeof import("../live/live.ts"), w: Wallet, profile: Profile) => Promise<string>, createIfNeeded = false) => {
      if (!wallet) return say("Connect the wallet first.");
      lock(true);
      say(`${what}…`);
      try {
        const profile = activeProfile() ?? (createIfNeeded ? await newProfile() : null);
        if (!profile) return say("Choose a player profile to continue.");
        if (createIfNeeded) renderProfiles();
        const mod = await loadLive();
        Object.assign(window as unknown as Record<string, unknown>, { __live: mod });
        say(await run(mod, wallet, profile));
      } catch (e) {
        fail(e);
      } finally {
        lock(false);
      }
    };
    findSeat.onclick = () => withLive("Public seating", async (_, w, profile) => {
      if (queueProfile !== profile.id || !queue) {
        resetDraw();
        const { PublicQueue } = await import("../live/public-queue.ts");
        queue = new PublicQueue(w, profile);
        queueProfile = profile.id;
      }
      const q = queue;
      clearTimeout(poll);
      if (displayed?.action === "finished") await q.forget();
      else if (displayed && displayed.action !== "wait") {
        const seated = await q.act(displayed.action, say);
        if (seated) {
          pageAddress("");
          leave({ profile, mode: "live", access: "draw", ...seated });
          return "Your public seat is ready.";
        }
      }
      await refreshDraw(q);
      return `${w.name} on ${w.networkId}.`;
    });
    const openLobby = (table: string) => {
      resetDraw();
      address.value = table;
      const panel = el.querySelector<HTMLElement>(".invite-lobby")!;
      const setup = panel.querySelector<HTMLElement>(".lobby-setup")!;
      setup.prepend(el.querySelector<HTMLElement>(".profiles")!, live);
      const home = new URL(location.href);
      home.searchParams.delete("table");
      if (!NETWORKS.includes(selected)) home.searchParams.delete("network");
      home.hash = "tables";
      for (const back of panel.querySelectorAll<HTMLAnchorElement>(".lobby-back")) back.href = home.href;
      home.hash = "wallet-setup";
      live.querySelector<HTMLAnchorElement>('a[href="#wallet-setup"]')!.href = home.href;
      network.hidden = publicSeating.hidden = invites.hidden = true;
      live.querySelector("h3")!.textContent = "Wallet";
      panel.hidden = false;
      el.classList.add("show-invite");
      el.scrollTop = 0;
      panel.querySelector<HTMLElement>("h1")!.focus({ preventScroll: true });
      lobby = inviteLobby(panel, selected, table);
      setup.hidden = !lobby.valid;
      connectButton.hidden = !!wallet || !lobby.valid;
      say(wallet ? `${wallet.name} on ${selected}.` : `Connect Lace on ${selected} to join.`);
      lobby.setWallet(wallet);
      lobby.join.onclick = () => withLive("Joining the table", async (mod, w, profile) => {
        const joined = await mod.joinTable(w, profile, table);
        leave({ profile, mode: "live", access: "invite", ...joined });
        return `Seat ${joined.seat.index + 1} is yours.`;
      }, true);
    };
    live.querySelector<HTMLButtonElement>(".view-table")!.onclick = () => {
      const table = address.value.trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(table)) return say("A table address is 64 hex characters.");
      pageAddress(table);
      openLobby(table);
    };
    el.querySelector<HTMLButtonElement>(".deploy")!.onclick = () =>
      withLive("Opening a table", async (mod, w, profile) => {
        const deployed = await mod.deployTable(w, profile, say);
        pageAddress(deployed);
        openLobby(deployed);
        return "Your table is open. Copy the invite link for your friends.";
      });
    if (params.has("table")) openLobby(address.value.trim().toLowerCase());
  });
}
