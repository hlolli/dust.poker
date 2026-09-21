import { setFor } from "../scene/lounge.ts";
import type { Chain } from "../live/chain.ts";
import type { Seat } from "../referee/contract.ts";
import { MODELS } from "../scene/models.ts";
import { connect, installed, type Wallet } from "../live/wallet.ts";
import { startBackdrop } from "./backdrop.ts";
import { showCreator } from "./creator.ts";
import { activate, activeProfile, createProfile, type Profile, profiles, removeProfile, updateProfile } from "./profiles.ts";

/**
 * The main menu, before the room loads: the house marquee, then a letterboard with three
 * lines, like a casino's show listing. Who is playing (profiles, as brass name plates), the
 * Practice table (lit), and the Live table (unlit until Lace has answered: then the network,
 * then a table to join or deploy). Styled in src/index.html (.menu). Resolves when the
 * player sits down, at Practice or at a Live table they have joined.
 */
/** What the menu resolves with: the Practice table, or a Live one you have a seat at. */
export type Entry = { profile: Profile; mode: "practice" } | { profile: Profile; mode: "live"; chain: Chain; seat: Seat };

export function showMenu(): Promise<Entry> {
  return new Promise((resolve) => {
    const el = document.createElement("main");
    el.className = "menu";
    el.innerHTML = `
      <header class="marquee">
        <div class="bulbs">${"<i></i>".repeat(28)}</div>
        <div class="sign">
          <h1>dust.poker</h1>
          <p>No-limit hold'em, refereed on Midnight</p>
        </div>
      </header>
      <div class="board">
        <section class="line profiles">
          <h2>Who is playing</h2>
          <div class="plates"></div>
        </section>
        <section class="line practice">
          <button class="listing go" type="button">
            <span class="title">Practice table</span>
            <span class="sub">Five bots, nothing at stake, the referee runs in this browser</span>
          </button>
        </section>
        <section class="line live unlit">
          <div class="listing">
            <span class="title">Live table</span>
            <span class="sub status">Real chips, refereed on Midnight. Connect Lace to see the tables.</span>
          </div>
          <div class="row">
            <button class="connect" type="button">Connect Lace</button>
            <div class="network" hidden>${["mainnet", "preprod", "preview"].map((n) => `<label class="ticket"><input type="radio" name="network" value="${n}" /><span>${n}</span></label>`).join("")}</div>
          </div>
          <div class="row table" hidden>
            <input name="table" placeholder="Table address" autocomplete="off" spellcheck="false" />
            <button class="join" type="button">Take a seat</button>
            <button class="deploy" type="button">Open a new table</button>
          </div>
        </section>
      </div>
      <footer class="foot">
        <div class="suits"><span>&spades;</span><span class="red">&hearts;</span><span class="red">&diams;</span><span>&clubs;</span></div>
        <p class="bandstand"></p>
        <p class="small">Test chips only: nothing here is worth anything yet. Every part of this room is built from the <a href="https://github.com/hlolli/dust.poker">public repository</a>, rules and pot included.</p>
      </footer>`;
    document.body.append(el);

    // The bandstand line: what the house band is playing this hour, by the UTC clock.
    const KEYS = ["C", "D flat", "D", "E flat", "E", "F", "F sharp", "G", "A flat", "A", "B flat", "B"];
    const bandstand = el.querySelector<HTMLParagraphElement>(".bandstand")!;
    const tonight = () => {
      const set = setFor(new Date().getUTCHours());
      const band = ["bass", set.ride && "brushes", set.piano && "piano", set.vibes && "vibes"].filter(Boolean).join(", ");
      const feel = set.tempo < 80 ? "a ballad" : set.tempo < 100 ? "medium swing" : "uptempo";
      bandstand.textContent = `On the bandstand this hour: set ${set.hour + 1} of 24, ${feel} in ${KEYS[set.key]}, ${set.tempo} to the minute, ${band}.`;
    };
    tonight();
    const bandTimer = setInterval(tonight, 60_000);
    const backdrop = startBackdrop(el);

    // ---- Profiles ---------------------------------------------------------------------------
    const plates = el.querySelector<HTMLDivElement>(".plates")!;
    const go = el.querySelector<HTMLButtonElement>(".go")!;
    const renderProfiles = () => {
      const { active, list } = profiles();
      const add = document.createElement("button");
      add.type = "button";
      add.className = "plate add";
      add.textContent = list.length ? "+ another" : "+ your name";
      add.onclick = async () => {
        const made = await showCreator();
        if (made) createProfile(made.name, made.look);
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
              const changed = await showCreator({ name: p.name, look: p.look });
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
      go.disabled = !active;
      el.querySelector(".practice")!.classList.toggle("unlit", !active);
    };
    renderProfiles();

    // ---- Practice ---------------------------------------------------------------------------
    const leave = (entry: Entry) => {
      backdrop.stop();
      clearInterval(bandTimer);
      el.remove();
      resolve(entry);
    };
    go.onclick = () => {
      const profile = activeProfile();
      if (profile) leave({ profile, mode: "practice" });
    };

    // ---- Live -------------------------------------------------------------------------------
    const live = el.querySelector<HTMLElement>(".live")!;
    const status = el.querySelector<HTMLSpanElement>(".status")!;
    const connectButton = el.querySelector<HTMLButtonElement>(".connect")!;
    const network = el.querySelector<HTMLDivElement>(".network")!;
    const table = el.querySelector<HTMLDivElement>(".table")!;
    const address = el.querySelector<HTMLInputElement>("input[name=table]")!;
    address.value = new URLSearchParams(location.search).get("table") ?? "";
    let wallet: Wallet | null = null;
    const say = (s: string) => (status.textContent = s);
    const fail = (e: unknown) => say(e instanceof Error ? e.message : String(e));
    const connected = (w: Wallet) => {
      wallet = w;
      Object.assign(window as unknown as Record<string, unknown>, { __wallet: w }); // inspection handle
      say(`${w.name} on ${w.networkId}: ${w.address.slice(0, 22)}...${w.address.slice(-6)}`);
      live.classList.remove("unlit");
      network.hidden = false;
      table.hidden = false;
      for (const r of network.querySelectorAll<HTMLInputElement>("input")) r.checked = r.value === w.networkId;
      connectButton.hidden = true;
    };
    connectButton.onclick = async () => {
      const [found] = installed();
      if (!found) return say("No Midnight wallet in this browser. Install Lace, then reload.");
      say(`${found.name}: confirm in the wallet`);
      connectButton.disabled = true;
      // Lace connects to one network at a time and wants it named; ask for each until one answers.
      let error: unknown = null;
      for (const id of ["mainnet", "preprod", "preview"]) {
        try {
          return connected(await connect(found, id));
        } catch (e) {
          error = e;
        }
      }
      connectButton.disabled = false;
      fail(error);
    };
    network.onchange = async (e) => {
      const id = (e.target as HTMLInputElement).value;
      const [found] = installed();
      if (!found) return;
      say(`Switching to ${id}: confirm in the wallet`);
      try {
        connected(await connect(found, id));
      } catch (err) {
        fail(err);
        if (wallet) for (const r of network.querySelectorAll<HTMLInputElement>("input")) r.checked = r.value === wallet.networkId;
      }
    };
    const withLive = async (what: string, run: (live: typeof import("../live/live.ts"), w: Wallet, profile: Profile) => Promise<string>) => {
      const profile = activeProfile();
      if (!wallet) return say("Connect the wallet first.");
      if (!profile) return say("Put your name on a plate first: it is your identity at the table.");
      say(`${what}: confirm in the wallet`);
      try {
        const [{ ready: runtimeReady }, { ready: ledgerReady }] = await Promise.all([import("../compact/onchain-runtime-shim.js"), import("../live/ledger-shim.js")]);
        await Promise.all([runtimeReady, ledgerReady]);
        const mod = await import("../live/live.ts");
        Object.assign(window as unknown as Record<string, unknown>, { __live: mod });
        say(await run(mod, wallet, profile));
      } catch (e) {
        fail(e);
      }
    };
    el.querySelector<HTMLButtonElement>(".join")!.onclick = () =>
      withLive("Taking a seat", async (mod, w, profile) => {
        if (!/^[0-9a-f]{64}$/i.test(address.value.trim())) throw new Error("A table address is 64 hex characters.");
        const { chain, seat } = await mod.joinTable(w, profile, address.value.trim());
        leave({ profile, mode: "live", chain, seat });
        return `Seat ${seat.index + 1} is yours.`;
      });
    el.querySelector<HTMLButtonElement>(".deploy")!.onclick = () =>
      withLive("Opening a table", async (mod, w, profile) => {
        const deployed = await mod.deployTable(w, profile);
        address.value = deployed;
        history.replaceState(null, "", `?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(location.search)), table: deployed })}`);
        return "The table is open. Its address is in the box and in this page's address: share it.";
      });
  });
}
