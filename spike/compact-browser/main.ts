// Spike: does a compiled Compact contract execute in a browser page bundled by Bun,
// with no node, no proof server? Uses midnight-js's precompiled counter contract.
const out = document.getElementById("out")!;
const log = (s: string) => (out.textContent += "\n" + s);

type PS = { privateCounter: number };
const witnesses = {
  privateIncrement: ({ privateState }: { privateState: PS }): [PS, []] => [
    { privateCounter: privateState.privateCounter + 1 },
    [],
  ],
};

try {
  const t0 = performance.now();
  // Order matters: the wasm must be instantiated before compact-runtime evaluates.
  await (await import("./wasm-shim.js")).ready;
  const tWasm = performance.now();
  const { createCircuitContext, dummyContractAddress, emptyZswapLocalState } = await import(
    "@midnight-ntwrk/compact-runtime"
  );
  const { Contract, ledger } = await import("./contract/index.js");
  log(`wasm ready in ${Math.round(tWasm - t0)} ms, runtime loaded in ${Math.round(performance.now() - tWasm)} ms`);

  const coinPublicKey = "11".repeat(32);
  const contract = new Contract(witnesses);

  const init = contract.initialState({
    initialPrivateState: { privateCounter: 0 },
    initialZswapLocalState: emptyZswapLocalState(coinPublicKey),
  });
  log(`initialState ok: round=${ledger(init.currentContractState.data).round}`);

  let ctx = createCircuitContext(
    dummyContractAddress(),
    coinPublicKey,
    init.currentContractState.data,
    init.currentPrivateState,
  );

  const tCirc = performance.now();
  for (let i = 0; i < 3; i++) {
    ctx = contract.circuits.increment(ctx).context;
  }
  const r = contract.circuits.decrement(ctx, 1n);
  ctx = r.context;
  const circuitMs = performance.now() - tCirc;

  const round = ledger(ctx.currentQueryContext.state).round;
  log(`after 3x increment, 1x decrement: round=${round} privateCounter=${ctx.currentPrivateState.privateCounter}`);
  log(`4 circuit calls in ${circuitMs.toFixed(1)} ms; public transcript ops in last call: ${r.proofData.publicTranscript.length}`);

  try {
    contract.circuits.decrement(ctx, 100n);
    log("FAIL: underflow did not throw");
  } catch (e) {
    log(`assert path ok: ${(e as Error).constructor.name}: ${(e as Error).message.slice(0, 100)}`);
  }

  log(`total ${Math.round(performance.now() - t0)} ms`);
  log(round === 2n ? "SPIKE PASS" : "SPIKE FAIL: wrong round");
} catch (e) {
  log(`SPIKE FAIL: ${(e as Error).stack ?? e}`);
}
