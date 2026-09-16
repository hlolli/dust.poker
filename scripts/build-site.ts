// Builds the static site into dist/ with the wasm shim plugin (the CLI `bun build` takes no
// plugins). The referee imports the compiled contract, so a fresh checkout (Vercel, CI)
// compiles the contracts first; `bun run check` has already done so.
import { $ } from "bun";
import { cpSync, existsSync } from "node:fs";
import plugin from "./wasm-plugin.ts";

const root = `${import.meta.dir}/..`;
if (!existsSync(`${root}/contracts/build/deal/contract/index.js`)) {
  console.log("compiling the contracts first");
  await $`bun ${root}/scripts/build-contracts.ts`;
}
// The proving keys, when this checkout has them (compact:build --zk): the Live table's wallet
// prover fetches them from /deal (src/live/live.ts). Without them the site builds and Practice plays.
if (existsSync(`${root}/contracts/build/deal/keys`)) {
  for (const d of ["keys", "zkir"]) cpSync(`${root}/contracts/build/deal/${d}`, `${root}/dist/deal/${d}`, { recursive: true });
  console.log("proving keys copied to dist/deal");
}
const result = await Bun.build({
  entrypoints: [`${root}/src/index.html`],
  outdir: `${root}/dist`,
  minify: true,
  plugins: [plugin],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
for (const o of result.outputs) console.log(`  ${o.path.replace(`${root}/`, "")}  ${(o.size / 1024).toFixed(0)} KB`);
console.log(`Built ${result.outputs.length} files`);
