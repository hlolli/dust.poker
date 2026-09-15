// The threaded benchmark body. Runs in a Worker: rayon's pool cannot be driven from the
// browser's main thread (it may not block on atomics), so proving lives here, as in
// Midnight's own wasm-proving-demos/webpage/src/workerMt.js.
const log = (s: string) => postMessage({ log: s });
const ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;

onmessage = async (m: MessageEvent<{ threads: number }>) => {
  try {
    const { threads } = m.data;
    const t0 = performance.now();
    log("worker started");
    await (await import("./shim-onchain-runtime.js")).ready;
    log("on-chain runtime wasm ready");
    const rt = await import("@midnight-ntwrk/compact-runtime");
    const { Contract } = await import("../../contracts/build/deal/contract/index.js");
    log("compact-runtime and contract loaded");
    const proverUrl = "/prover-mt/index.js"; // kept out of the bundler's sight on purpose
    const zkir = await import(proverUrl);
    log("prover module imported");
    await zkir.default();
    log("prover wasm instantiated");
    await zkir.initThreadPool(threads);
    log(`wasm ready in ${Math.round(performance.now() - t0)} ms, thread pool of ${threads}`);

    const get = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
    const kmProvider = {
      async lookupKey(loc: string) {
        const irJson = await (await fetch(`/assets/${loc}.zkir`)).text();
        return { proverKey: await get(`/assets/${loc}.prover`), verifierKey: await get(`/assets/${loc}.verifier`), ir: zkir.jsonIrToBinary(irJson) };
      },
      async getParams(k: number) {
        return get(`/assets/bls_midnight_2p${k}`);
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
      const ctx = rt.createCircuitContext(circuit, address, coinPublicKey, state, {});
      const r = await (contract.circuits[circuit] as any)(ctx, ...a);
      state = r.context.callContext.currentQueryContext.state;
      const pd = r.context.callProofDataTrace.at(-1)!;
      preimages.set(circuit, rt.proofDataIntoSerializedPreimage(pd.input, pd.output, pd.publicTranscript, pd.privateTranscriptOutputs, circuit));
    };
    await run("post_key", 0n);
    await run("shuffle");
    await run("share", 0n, 3n);

    for (const circuit of ["post_key", "share", "shuffle"]) {
      const k = zkir.Zkir.fromJson(await (await fetch(`/assets/${circuit}.zkir`)).text()).getK();
      const t = performance.now();
      const proof: Uint8Array = await zkir.prove(preimages.get(circuit)!, kmProvider);
      log(`${circuit}: k=${k}, proof ${proof.length} bytes in ${((performance.now() - t) / 1000).toFixed(1)} s with ${threads} threads`);
      if (circuit === "shuffle") {
        const t2 = performance.now();
        await zkir.prove(preimages.get(circuit)!, kmProvider);
        log(`  second shuffle proof in ${((performance.now() - t2) / 1000).toFixed(1)} s`);
      }
    }
    log("BENCH DONE");
  } catch (e) {
    log(`BENCH FAIL: ${(e as Error).stack ?? e}`);
  }
};
