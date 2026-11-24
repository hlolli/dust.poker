// Run on the local Ledger 9 stack. Four genesis wallets enter the same draw and
// one of the two resulting groups opens, claims and withdraws its assigned seats.
import { ready, playThroughShowdown } from "./table.ts";
import assert from "node:assert/strict";
import { config, root, scriptWallet, seed } from "./wallet.ts";
import type { Profile } from "../src/ui/profiles.ts";
import { DEFAULT_LOOK } from "../src/scene/look.ts";
const { PublicQueue, QUEUE_ADDRESS } = (await import(
  `${root}/src/live/public-queue.ts`
)) as typeof import("../src/live/public-queue.ts");
const { snapshot } = (await import(`${root}/src/live/indexer.ts`)) as typeof import("../src/live/indexer.ts");

async function main() {
  await ready();
  // Public genesis fixtures from the pinned node image:
  // https://github.com/midnightntwrk/midnight-node/blob/node-2.1.101/Earthfile#L322-L325
  const genesis = [
    seed(1),
    seed(2),
    seed(3),
    "a51c86de32d0791f7cffc3bdff1abd9bb54987f0ed5effc30c936dddbb9afd9d530c8db445e4f2d3ea42a321b260e022aadf05987c9a67ec7b6b6ca1d0593ec9",
  ];
  const wallets = await Promise.all(genesis.map((master, i) => scriptWallet(`Player ${i + 1}`, master)));
  try {
    const people = wallets.map((w, i) => {
      const p: Profile = { id: w.name, name: w.name, look: DEFAULT_LOOK, secret: String(i + 1) };
      const memory = new Map<string, string>();
      const store = {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => {
          memory.set(k, v);
        },
        removeItem: (k: string) => {
          memory.delete(k);
        },
      };
      return { w, q: new PublicQueue(w, p, store), resume: () => new PublicQueue(w, p, store) };
    });
    const first = people[0]!.q;
    if ((await first.status()).action === "open") await first.act("open", console.log);
    // Four independent confirmed registrations must fit one on-chain window.
    for (;;) {
      const time = (await snapshot(config.indexerUri, QUEUE_ADDRESS)).block.timestamp;
      if (time % 300 < 45) break;
      await Bun.sleep(4000);
    }
    const initial = await Promise.all(wallets.map((w) => w.nightBalance()));
    await Promise.all(
      people.map(async ({ q }) => {
        assert.equal((await q.status()).action, "enter");
        await q.act("enter", console.log);
        assert.equal((await q.status()).action, "wait");
      }),
    );
    let matches = await Promise.all(people.map(({ q }) => q.status()));
    for (let i = 0; !matches.some((m) => m.action === "host") && i < 100; i++) {
      await Bun.sleep(5000);
      matches = await Promise.all(people.map(({ q }) => q.status()));
    }
    assert.equal(matches.filter((m) => m.action === "host").length, 2);
    const host = people[matches.findIndex((m) => m.action === "host")]!;
    await host.q.act("host", console.log);
    const seated = [];
    for (const person of people) {
      if ((await person.q.status()).action !== "join") continue;
      const entry = await person.q.act("join", console.log);
      assert.ok(entry);
      assert.equal((await person.resume().status()).action, "resume");
      await assert.rejects(person.resume().forget(), /cash out/);
      seated.push({ person, entry });
    }
    assert.equal(seated.length, 2);
    assert.equal(seated[0]!.entry.chain.address, seated[1]!.entry.chain.address);
    await playThroughShowdown(seated[0]!.entry, seated[1]!.entry);
    for (const { person } of seated) assert.equal((await person.resume().status()).action, "finished");
    const total = (balances: bigint[]) => balances.reduce((a, b) => a + b, 0n);
    for (let retry = 0; retry < 60; retry++) {
      if (total(await Promise.all(wallets.map((w) => w.nightBalance()))) === total(initial)) break;
      await Bun.sleep(2000);
    }
    assert.equal(total(await Promise.all(wallets.map((w) => w.nightBalance()))), total(initial));
    console.log(
      "Public seating passed: four wallets, two drawn tables, a verified roster, two claimed seats, reload, showdown and withdrawal.",
    );
  } finally {
    await Promise.all(wallets.map((w) => w.close()));
  }
}
main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
