// Proves the dealing circuits with Midnight's wasm prover and reports the time.
//
//   scripts/build-prover.sh && bun run compact:build --zk && bun scripts/bench-prove.ts
//
// Defaults point at .compact/prover (from build-prover.sh) and contracts/build/deal (from
// compact:build --zk); override with --zkir-wasm, --keys, --zkir, --params, --circuits.
// KZG parameters missing from the params dir are fetched from Midnight's public bucket.
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import {
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
  proofDataIntoSerializedPreimage,
} from "@midnight-ntwrk/compact-runtime";
import { Contract } from "../contracts/build/deal/contract/index.js";

const root = `${import.meta.dir}/..`;
const { values: args } = parseArgs({
  options: {
    "zkir-wasm": { type: "string", default: `${root}/.compact/prover/zkir-wasm` },
    keys: { type: "string", default: `${root}/contracts/build/deal/keys` },
    zkir: { type: "string", default: `${root}/contracts/build/deal/zkir` },
    params: { type: "string", default: `${root}/.compact/prover/params` },
    circuits: { type: "string", default: "post_key,share,shuffle" },
  },
});

const PARAMS_URL = "https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com/bls_midnight_2p";
const ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const coinPublicKey = "11".repeat(32);
const address = dummyContractAddress();
type PS = Record<string, never>;

const zkir = await import(`${args["zkir-wasm"]}/midnight_zkir_wasm_fs.js`);

const kmProvider = {
  async lookupKey(keyLocation: string) {
    console.log(`  lookupKey(${keyLocation})`);
    const read = (p: string) => Bun.file(p).bytes();
    return {
      proverKey: await read(`${args.keys}/${keyLocation}.prover`),
      verifierKey: await read(`${args.keys}/${keyLocation}.verifier`),
      // The prover's own binary IR encoding, from the JSON compactc emits; compactc's
      // .bzkir is a different serialization that this crate does not read.
      ir: zkir.jsonIrToBinary(await Bun.file(`${args.zkir}/${keyLocation}.zkir`).text()),
    };
  },
  async getParams(k: number) {
    await mkdir(args.params!, { recursive: true });
    const file = `${args.params}/bls_midnight_2p${k}`;
    if (!existsSync(file)) {
      console.log(`  fetching params k=${k} from ${PARAMS_URL}${k}`);
      const res = await fetch(`${PARAMS_URL}${k}`);
      if (!res.ok) throw new Error(`params k=${k}: ${res.status}`);
      await Bun.write(file, await res.arrayBuffer());
    }
    const bytes = await Bun.file(file).bytes();
    console.log(`  params k=${k}: ${(bytes.length / 1048576).toFixed(1)} MB`);
    return bytes;
  },
};

function randomScalar(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return (n % (ORDER - 1n)) + 1n;
}
const permutation = Array.from({ length: 52 }, (_, i) => BigInt(i));
for (let i = 51; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [permutation[i], permutation[j]] = [permutation[j]!, permutation[i]!];
}
const x = randomScalar();
const contract = new Contract<PS>({
  deck_key: (ctx) => [ctx.privateState, x],
  permutation: (ctx) => [ctx.privateState, permutation],
  blinding: (ctx) => [ctx.privateState, Array.from({ length: 52 }, randomScalar)],
});

// Run the circuits locally to get the proof preimages, in a realistic order.
let state: Parameters<typeof createCircuitContext>[3] = (await contract.initialState(createConstructorContext<PS>({}, coinPublicKey)))
  .currentContractState;
const preimages = new Map<string, Uint8Array>();
async function run(circuit: "post_key" | "shuffle" | "share", ...a: bigint[]) {
  const ctx = createCircuitContext(circuit, address, coinPublicKey, state, {} as PS);
  const r = await (contract.circuits[circuit] as (c: typeof ctx, ...z: bigint[]) => Promise<any>)(ctx, ...a);
  state = r.context.callContext.currentQueryContext.state;
  // The root circuit's proof data is the last entry of the call trace (depth-first order).
  const pd = r.context.callProofDataTrace.at(-1)!;
  preimages.set(circuit, proofDataIntoSerializedPreimage(pd.input, pd.output, pd.publicTranscript, pd.privateTranscriptOutputs, circuit));
}
await run("post_key", 0n);
await run("shuffle");
await run("share", 0n, 3n);

for (const circuit of args.circuits!.split(",")) {
  const k = zkir.Zkir.fromJson(await Bun.file(`${args.zkir}/${circuit}.zkir`).text()).getK();
  const preimage = preimages.get(circuit)!;
  console.log(`\n${circuit}: k=${k} (2^${k} rows), preimage ${preimage.length} bytes`);
  const t0 = performance.now();
  const proof: Uint8Array = await zkir.prove(preimage, kmProvider);
  const ms = performance.now() - t0;
  console.log(`  proof ${proof.length} bytes in ${(ms / 1000).toFixed(1)} s (includes key and params loading)`);
  const t1 = performance.now();
  const proof2: Uint8Array = await zkir.prove(preimage, kmProvider);
  console.log(`  second proof ${proof2.length} bytes in ${((performance.now() - t1) / 1000).toFixed(1)} s`);
}
console.log(`\nrss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`);
