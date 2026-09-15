import wasmUrl from "zkir-wasm-pkg/midnight_zkir_wasm_bg.wasm";
import * as bg from "zkir-wasm-pkg/midnight_zkir_wasm_bg.js";
export * from "zkir-wasm-pkg/midnight_zkir_wasm_bg.js";

export const ready = WebAssembly.instantiateStreaming(fetch(wasmUrl), {
  "./midnight_zkir_wasm_bg.js": bg,
}).then(({ instance }) => {
  bg.__wbg_set_wasm(instance.exports);
  instance.exports.__wbindgen_start();
});
