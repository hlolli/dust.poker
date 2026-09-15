import wasmUrl from "../../node_modules/@midnightntwrk/onchain-runtime-v4/midnight_onchain_runtime_wasm_bg.wasm";
import * as bg from "../../node_modules/@midnightntwrk/onchain-runtime-v4/midnight_onchain_runtime_wasm_bg.js";
export * from "../../node_modules/@midnightntwrk/onchain-runtime-v4/midnight_onchain_runtime_wasm_bg.js";

export const ready = WebAssembly.instantiateStreaming(fetch(wasmUrl), {
  "./midnight_onchain_runtime_wasm_bg.js": bg,
}).then(({ instance }) => {
  bg.__wbg_set_wasm(instance.exports);
  instance.exports.__wbindgen_start();
});
