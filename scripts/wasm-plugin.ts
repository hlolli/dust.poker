// Bun plugin: the on-chain runtime's browser entry imports its wasm as an ES module, which
// Bun does not bundle; swap in src/compact/onchain-runtime-shim.js, which instantiates the
// wasm from a URL. Used by the dev server (bunfig.toml) and the site build (build-site.ts).
import type { BunPlugin } from "bun";
import { resolve } from "node:path";

const shim = resolve(import.meta.dir, "../src/compact/onchain-runtime-shim.js"); // Bun wants it normalized

const plugin: BunPlugin = {
  name: "onchain-runtime-wasm-shim",
  setup(build) {
    build.onResolve({ filter: /^@midnightntwrk\/onchain-runtime-v4$/ }, () => ({ path: shim }));
  },
};

export default plugin;
