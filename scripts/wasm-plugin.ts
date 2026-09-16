// Bun plugin: Midnight's wasm packages have browser entries that import their wasm as an ES
// module, which Bun does not bundle; swap in our shims, which instantiate the wasm from a URL.
// Used by the dev server (bunfig.toml) and the site build (build-site.ts).
import type { BunPlugin } from "bun";
import { resolve } from "node:path";

const shims: Record<string, string> = {
  "@midnightntwrk/onchain-runtime-v4": resolve(import.meta.dir, "../src/compact/onchain-runtime-shim.js"), // Bun wants paths normalized
  "@midnightntwrk/ledger-v9": resolve(import.meta.dir, "../src/live/ledger-shim.js"),
};

const plugin: BunPlugin = {
  name: "midnight-wasm-shims",
  setup(build) {
    build.onResolve({ filter: /^@midnightntwrk\/(onchain-runtime-v4|ledger-v9)$/ }, (args) => ({ path: shims[args.path]! }));
    // The ledger's wasm-bindgen snippets import their own package as `#self`, which its exports
    // map points at the browser entry we are replacing; send them to the shim as well.
    build.onResolve({ filter: /^#self$/ }, (args) => (args.importer.includes("@midnightntwrk/ledger-v9/") ? { path: shims["@midnightntwrk/ledger-v9"]! } : undefined));
  },
};

export default plugin;
