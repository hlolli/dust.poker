import { setFor } from "../scene/lounge-score.ts";
import type { Chain } from "../live/chain.ts";
import type { KeyStore } from "../live/referee.ts";
import type { Seat } from "../referee/contract.ts";
import { MODELS } from "../scene/models.ts";
import { checkIndexer } from "../live/indexer.ts";
import { connect, installed, NETWORKS, network as asked, type Wallet } from "../live/wallet.ts";
import { activate, activeProfile, createProfile, type Profile, profiles, removeProfile, updateProfile } from "./profiles.ts";

/** What the menu resolves with: the Practice table, or a Live one you have a seat at. */
export type Entry = { profile: Profile; mode: "practice" } | { profile: Profile; mode: "live"; chain: Chain; seat: Seat; store: KeyStore };

export function showMenu(): Promise<Entry> {
  return new Promise((resolve) => {
    const el = document.querySelector<HTMLElement>("main.menu")!;
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
    };
    renderProfiles();

    // ---- Practice ---------------------------------------------------------------------------
    const leave = (entry: Entry) => {
      clearInterval(bandTimer);
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
    const table = el.querySelector<HTMLDivElement>(".table")!;
    const funding = el.querySelector<HTMLElement>(".funding")!;
    const address = el.querySelector<HTMLInputElement>("input[name=table]")!;
    const share = el.querySelector<HTMLButtonElement>(".share")!;
    const params = new URLSearchParams(location.search);
    address.value = params.get("table") ?? "";
    if (!location.hash && (address.value || params.has("network"))) {
      el.querySelector(activeProfile() ? "#live-table" : ".profiles")!.scrollIntoView();
    }
    let selected = asked();
    let wallet: Wallet | null = null;
    const say = (s: string) => (status.textContent = s);
    const fail = (e: unknown) => say(typeof e === "object" && e !== null && "message" in e ? String(e.message) : String(e));
    const lock = (busy: boolean) => {
      for (const control of live.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) control.disabled = busy;
    };
    const pageAddress = (tableAddress: string) => {
      const url = new URL(location.href);
      url.searchParams.set("network", selected);
      if (tableAddress) url.searchParams.set("table", tableAddress);
      else url.searchParams.delete("table");
      history.replaceState(null, "", url);
    };
    const updateShare = () => { share.hidden = !/^[a-f\d]{64}$/i.test(address.value.trim()); };
    address.oninput = updateShare;
    updateShare();
    share.onclick = async () => {
      const invite = new URL(location.pathname, location.origin);
      invite.search = new URLSearchParams({ network: selected, table: address.value.trim() }).toString();
      try {
        await navigator.clipboard.writeText(invite.href);
        say("Table link copied. Each player can open it and take a seat.");
      } catch {
        say(`Share this table link: ${invite.href}`);
      }
    };
    for (const radio of network.querySelectorAll<HTMLInputElement>("input")) radio.checked = radio.value === selected;
    if (address.value) say(`This table invite is for ${selected}. Choose that network in Lace, then connect.`);
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
        table.hidden = false;
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
      updateShare();
      live.classList.add("unlit");
      table.hidden = true;
      funding.hidden = true;
      connectButton.hidden = false;
      say(`Select ${selected} in Lace, then connect.`);
    };
    const withLive = async (what: string, run: (live: typeof import("../live/live.ts"), w: Wallet, profile: Profile) => Promise<string>) => {
      const profile = activeProfile();
      if (!wallet) return say("Connect the wallet first.");
      if (!profile) return say("Put your name on a plate first: it is your identity at the table.");
      lock(true);
      say(`${what}: confirm in the wallet`);
      try {
        const [{ ready: runtimeReady }, { ready: ledgerReady }] = await Promise.all([import("../compact/onchain-runtime-shim.js"), import("../live/ledger-shim.js")]);
        await Promise.all([runtimeReady, ledgerReady]);
        const mod = await import("../live/live.ts");
        Object.assign(window as unknown as Record<string, unknown>, { __live: mod });
        say(await run(mod, wallet, profile));
      } catch (e) {
        fail(e);
      } finally {
        lock(false);
      }
    };
    el.querySelector<HTMLButtonElement>(".join")!.onclick = () =>
      withLive("Taking a seat", async (mod, w, profile) => {
        if (!/^[0-9a-f]{64}$/i.test(address.value.trim())) throw new Error("A table address is 64 hex characters.");
        const { chain, seat, store } = await mod.joinTable(w, profile, address.value.trim());
        pageAddress(chain.address);
        leave({ profile, mode: "live", chain, seat, store });
        return `Seat ${seat.index + 1} is yours.`;
      });
    el.querySelector<HTMLButtonElement>(".deploy")!.onclick = () =>
      withLive("Opening a table", async (mod, w, profile) => {
        const deployed = await mod.deployTable(w, profile, say);
        address.value = deployed;
        pageAddress(deployed);
        updateShare();
        return "The table is open. Copy the table link for your colleagues, then take a seat.";
      });
  });
}
