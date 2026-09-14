export interface Contender {
  /** Chips put into the pot over the whole deal. */
  total: number;
  folded: boolean;
  /** Hand score; ignored when folded. */
  score: number;
}

/**
 * Splits the pot, side pots included. Each distinct contribution level of a live
 * seat forms a layer; the layer goes to the best live hand among seats that reached it.
 * Odd chips go to the first winner clockwise from the dealer. Returns chips won per seat.
 */
export function settle(seats: (Contender | null)[], dealer: number): number[] {
  const n = seats.length;
  const payouts = new Array<number>(n).fill(0);
  const live = seats.map((s, i) => (s && !s.folded ? i : -1)).filter((i) => i >= 0);
  const levels = [...new Set(live.map((i) => seats[i]!.total))].sort((a, b) => a - b);
  const fromDealer = (i: number) => (i - dealer - 1 + n) % n;

  let prev = 0;
  let lastWinners: number[] = [];
  for (const level of levels) {
    let pot = 0;
    for (const s of seats) if (s) pot += Math.max(0, Math.min(s.total, level) - prev);
    const eligible = live.filter((i) => seats[i]!.total >= level);
    const best = Math.max(...eligible.map((i) => seats[i]!.score));
    const winners = eligible.filter((i) => seats[i]!.score === best).sort((a, b) => fromDealer(a) - fromDealer(b));
    const share = Math.floor(pot / winners.length);
    winners.forEach((w, k) => (payouts[w]! += share + (k < pot - share * winners.length ? 1 : 0)));
    lastWinners = winners;
    prev = level;
  }

  // Chips folded players put in above every live seat's total. Cannot normally
  // happen, but never leave chips on the table.
  const total = seats.reduce((a, s) => a + (s?.total ?? 0), 0);
  const leftover = total - payouts.reduce((a, b) => a + b, 0);
  if (leftover > 0 && lastWinners.length) payouts[lastWinners[0]!]! += leftover;
  return payouts;
}
