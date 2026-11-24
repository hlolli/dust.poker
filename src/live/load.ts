/** Both wasm runtimes must be ready before importing the compiled Live circuits in a browser. */
export async function loadLive() {
  const [runtime, ledger] = await Promise.all([import("../compact/onchain-runtime-shim.js"), import("./ledger-shim.js")]);
  await Promise.all([runtime.ready, ledger.ready]);
  return import("./live.ts");
}
