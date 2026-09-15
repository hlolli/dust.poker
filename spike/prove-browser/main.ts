const out = document.getElementById("out")!;
const log = (s: string) => {
  out.textContent += "\n" + s;
  console.log(s);
};
const ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;

try {
  const t0 = performance.now();
  // Both wasm modules must be instantiated before the runtime evaluates.
  await (await import("./shim-onchain-runtime.js")).ready;
  await (await import("./shim-zkir.js")).ready;
  const rt = await import("@midnight-ntwrk/compact-runtime");
  const zkir = await import("@midnightntwrk/zkir-v2");
  const { Contract } = await import("../../contracts/build/deal/contract/index.js");
  log(`wasm ready in ${Math.round(performance.now() - t0)} ms`);

  const get = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
  const kmProvider = {
    async lookupKey(loc: string) {
      const t = performance.now();
      const irJson = await (await fetch(`assets/${loc}.zkir`)).text();
      const km = { proverKey: await get(`assets/${loc}.prover`), verifierKey: await get(`assets/${loc}.verifier`), ir: zkir.jsonIrToBinary(irJson) };
      log(`  keys for ${loc}: ${(km.proverKey.length / 1048576).toFixed(1)} MB in ${Math.round(performance.now() - t)} ms`);
      return km;
    },
    async getParams(k: number) {
      const t = performance.now();
      const p = await get(`assets/bls_midnight_2p${k}`);
      log(`  params k=${k}: ${(p.length / 1048576).toFixed(1)} MB in ${Math.round(performance.now() - t)} ms`);
      return p;
    },
  };

  const randomScalar = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    return (n % (ORDER - 1n)) + 1n;
  };
  const permutation = Array.from({ length: 52 }, (_, i) => BigInt(i));
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [permutation[i], permutation[j]] = [permutation[j]!, permutation[i]!];
  }
  const x = randomScalar();
  const contract = new Contract<Record<string, never>>({
    deck_key: (ctx) => [ctx.privateState, x],
    permutation: (ctx) => [ctx.privateState, permutation],
    blinding: (ctx) => [ctx.privateState, Array.from({ length: 52 }, randomScalar)],
  });
  const coinPublicKey = "11".repeat(32);
  const address = rt.dummyContractAddress();
  let state: any = (await contract.initialState(rt.createConstructorContext({}, coinPublicKey))).currentContractState;
  const preimages = new Map<string, Uint8Array>();
  const run = async (circuit: "post_key" | "shuffle" | "share", ...a: bigint[]) => {
    const t = performance.now();
    const ctx = rt.createCircuitContext(circuit, address, coinPublicKey, state, {});
    const r = await (contract.circuits[circuit] as any)(ctx, ...a);
    state = r.context.callContext.currentQueryContext.state;
    const pd = r.context.callProofDataTrace.at(-1)!;
    preimages.set(circuit, rt.proofDataIntoSerializedPreimage(pd.input, pd.output, pd.publicTranscript, pd.privateTranscriptOutputs, circuit));
    log(`executed ${circuit} locally in ${Math.round(performance.now() - t)} ms`);
  };
  await run("post_key", 0n);
  await run("shuffle");
  await run("share", 0n, 3n);

  for (const circuit of ["post_key", "share", "shuffle"]) {
    const k = zkir.Zkir.fromJson(await (await fetch(`assets/${circuit}.zkir`)).text()).getK();
    log(`\n${circuit}: k=${k}`);
    const t = performance.now();
    const proof: Uint8Array = await zkir.prove(preimages.get(circuit)!, kmProvider);
    log(`  proof ${proof.length} bytes in ${((performance.now() - t) / 1000).toFixed(1)} s (first, includes loading)`);
    if (circuit !== "shuffle") {
      const t2 = performance.now();
      await zkir.prove(preimages.get(circuit)!, kmProvider);
      log(`  second proof in ${((performance.now() - t2) / 1000).toFixed(1)} s`);
    }
  }
  const mem = (performance as any).memory;
  if (mem) log(`\njs heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB`);
  log("BENCH DONE");
} catch (e) {
  log(`BENCH FAIL: ${(e as Error).stack ?? e}`);
}
