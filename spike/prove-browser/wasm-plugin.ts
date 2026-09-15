import type { BunPlugin } from "bun";

// Bun treats `.wasm` imports as file URLs, so the two wasm-bindgen packages we need
// (the on-chain runtime under compact-runtime, and the zkir prover) get swapped for
// shims that fetch and instantiate the wasm by hand. Callers await each shim's `ready`.
export function wasmShims(zkirWasmDir: string): BunPlugin {
  return {
    name: "wasm-shims",
    setup(build) {
      build.onResolve({ filter: /^@midnightntwrk\/onchain-runtime-v4$/ }, () => ({
        path: `${import.meta.dir}/shim-onchain-runtime.js`,
      }));
      build.onResolve({ filter: /^@midnightntwrk\/zkir-v2$/ }, () => ({
        path: `${import.meta.dir}/shim-zkir.js`,
      }));
      // The zkir shim imports the package's files by an absolute path we only know at build time.
      build.onResolve({ filter: /^zkir-wasm-pkg\/(.*)$/ }, (a) => ({
        path: `${zkirWasmDir}/${a.path.replace(/^zkir-wasm-pkg\//, "")}`,
      }));
    },
  };
}
