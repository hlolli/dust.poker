// Profiles: who the player is at the table, kept in this browser. A name, a look (the
// creator's, scene/look.ts) and the secret that is the player's identity at a Live table (the
// seat owner's point is derived from it). Several may exist; one is in use.
// ponytail: localStorage. An exportable or wallet-derived identity when tables hold value.
import { DEFAULT_LOOK, type Look } from "../scene/look.ts";

export type Profile = { id: string; name: string; look: Look; secret: string };

const KEY = "dust.poker/profiles";

export function profiles(): { active: string | null; list: Profile[] } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const state = JSON.parse(raw) as { active: string | null; list: (Profile & { model?: number })[] };
      // Profiles from before the creator chose a base character only.
      for (const p of state.list) p.look ??= { ...DEFAULT_LOOK, model: p.model ?? 0 };
      return state;
    }
  } catch {
    /* unreadable storage: start fresh */
  }
  return { active: null, list: [] };
}

function save(state: ReturnType<typeof profiles>) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

/** A random scalar in the Jubjub group order, as the player's identity. */
function freshSecret(): string {
  const ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
  let n = 0n;
  for (const b of crypto.getRandomValues(new Uint8Array(64))) n = (n << 8n) | BigInt(b);
  return String((n % (ORDER - 1n)) + 1n);
}

export function createProfile(name: string, look: Look): Profile {
  const p: Profile = { id: crypto.randomUUID(), name: name.trim().slice(0, 24) || "Player", look, secret: freshSecret() };
  const state = profiles();
  state.list.push(p);
  state.active = p.id;
  save(state);
  return p;
}

/** A new name or look for an existing profile; the identity stays. */
export function updateProfile(id: string, name: string, look: Look) {
  const state = profiles();
  const p = state.list.find((x) => x.id === id);
  if (p) Object.assign(p, { name: name.trim().slice(0, 24) || p.name, look });
  save(state);
}

export function activate(id: string) {
  const state = profiles();
  if (state.list.some((p) => p.id === id)) state.active = id;
  save(state);
}

export function removeProfile(id: string) {
  const state = profiles();
  state.list = state.list.filter((p) => p.id !== id);
  if (state.active === id) state.active = state.list[0]?.id ?? null;
  save(state);
}

export function activeProfile(): Profile | null {
  const { active, list } = profiles();
  return list.find((p) => p.id === active) ?? null;
}
