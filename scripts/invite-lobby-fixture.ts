// Build a real one-player contract snapshot before starting the browser process.
import { Seat } from "../src/referee/contract.ts";
import { bytes, hex } from "../src/live/ledger.ts";
import { joinOn } from "../src/live/live.ts";
import { LocalChain } from "../src/live/local.ts";

const key = await Bun.file(new URL("../src/live/any.verifier", import.meta.url)).bytes();
const chain = await LocalChain.deploy(async () => key);
await joinOn(chain, new Seat("Alice", 7n), bytes(chain.me));
const { state, params } = await chain.snapshot();
console.log(JSON.stringify({
  address: chain.address,
  state: hex(state!.serialize()),
  opened: hex((await chain.opening()).serialize()),
  ledgerParameters: hex(params.serialize()),
}));
