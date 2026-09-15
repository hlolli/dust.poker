import type { Action, Legal } from "../referee/types.ts";

// ponytail: weighted-random legal actions with a fold bias when facing a bet.
// Card-aware bots come when losing to these stops being funny.
export function botAction(legal: Legal, rng: () => number = Math.random): Action {
  const r = rng();
  if (legal.check) {
    if (r < 0.7 || !legal.raise) return { type: "check" };
    return { type: "raise", to: raiseSize(legal, rng) };
  }
  if (r < 0.35) return { type: "fold" };
  if (r < 0.85 || !legal.raise) return { type: "call" };
  return { type: "raise", to: raiseSize(legal, rng) };
}

function raiseSize({ raise }: Legal, rng: () => number): number {
  const { min, max } = raise!;
  if (rng() < 0.08) return max; // the occasional shove
  return Math.min(max, Math.round(min + (max - min) * rng() * rng() * 0.25));
}
