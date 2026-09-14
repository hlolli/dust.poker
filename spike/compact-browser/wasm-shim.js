// Replaces @midnight-ntwrk/onchain-runtime-v2's browser entry, which does
// `import * as wasm from "./x_bg.wasm"` and needs a bundler with wasm-ESM support.
// Bun gives us the wasm as a URL instead, so we instantiate it by hand.
// No top-level await: Bun's dev-server HMR runtime does not block importers on it,
// so callers `await ready` before importing anything that touches the runtime.
import wasmUrl from "./node_modules/@midnight-ntwrk/onchain-runtime-v2/midnight_onchain_runtime_wasm_bg.wasm";
import * as bg from "./node_modules/@midnight-ntwrk/onchain-runtime-v2/midnight_onchain_runtime_wasm_bg.js";
export * from "./node_modules/@midnight-ntwrk/onchain-runtime-v2/midnight_onchain_runtime_wasm_bg.js";

export const ready = WebAssembly.instantiateStreaming(fetch(wasmUrl), {
  "./midnight_onchain_runtime_wasm_bg.js": bg,
}).then(({ instance }) => {
  bg.__wbg_set_wasm(instance.exports);
  instance.exports.__wbindgen_start();
});
