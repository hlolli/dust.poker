// Builds the static site into dist/ with the wasm shim plugin (the CLI `bun build` takes no
// plugins). The referee imports the compiled contract, so a fresh checkout (Vercel, CI)
// compiles the contracts first; `bun run check` has already done so.
import { $ } from "bun";
import { existsSync } from "node:fs";
import plugin from "./wasm-plugin.ts";

const root = `${import.meta.dir}/..`;
if (!existsSync(`${root}/contracts/build/deal/contract/index.js`)) {
  console.log("compiling the contracts first");
  await $`bun ${root}/scripts/build-contracts.ts`;
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
