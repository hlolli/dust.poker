import type { BunPlugin } from "bun";

const plugin: BunPlugin = {
  name: "onchain-runtime-wasm-shim",
  setup(build) {
    build.onResolve({ filter: /^@midnight-ntwrk\/onchain-runtime-v2$/ }, () => ({
      path: `${import.meta.dir}/wasm-shim.js`,
    }));
  },
};

export default plugin;
