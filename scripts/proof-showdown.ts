import { addr, CALL, RAISE, type Table } from "../contracts/harness.ts";

/** Collect the heads-up showdown and seat-management calls for the proof gate. */
export async function playProofShowdown(t: Table) {
  await t.dealt();
  await t.prepare();
  await t.checkAndRelease(); // preflop call and check, the flop released
  const flop = t.ledger;
  const raiser = Number(flop.to_act);
  await t.call(raiser, "act_out", BigInt(raiser), RAISE, flop.bet[raiser]! + flop.stack[raiser]!);
  const caller = Number(t.ledger.to_act);
  await t.call(caller, "act_out", BigInt(caller), CALL, 0n);
  await t.tableAll();
  await t.showAll();
  await t.call(0, "settle");
  // A split pot can leave both stacks at the maximum. Rejoin below it so the
  // buy-in has a legal preimage for every showdown result.
  await t.call(0, "stand_up", 0n, true);
  await t.call(0, "leave", 0n);
  await t.call(0, "join", addr(0), 100n);
  await t.call(0, "buy_in", 0n, 100n);
}
