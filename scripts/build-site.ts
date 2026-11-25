// Builds the static site into dist/ with the wasm shim plugin (the CLI `bun build` takes no
// plugins). The referee imports the compiled contract, so a fresh checkout (Vercel, CI)
// compiles the contracts first; `bun run check` has already done so.
import { $ } from "bun";
import { cpSync, existsSync } from "node:fs";
import plugin from "./wasm-plugin.ts";

const root = `${import.meta.dir}/..`;
const contracts = ["deal", "queue", "public-seat"];
if (contracts.some(name => !existsSync(`${root}/contracts/build/${name}/contract/index.js`))) {
  console.log("compiling the contracts first");
  await $`bun ${root}/scripts/build-contracts.ts`;
}
// The proving keys, when this checkout has them (compact:build --zk): the Live table's wallet
// prover fetches them from /deal (src/live/live.ts). Without them the site builds and Practice plays.
for (const name of contracts) {
  if (!existsSync(`${root}/contracts/build/${name}/keys`)) continue;
  for (const d of ["keys", "zkir"]) cpSync(`${root}/contracts/build/${name}/${d}`, `${root}/dist/${name}/${d}`, { recursive: true });
}
// Stable public URLs for the social preview and locally hosted fonts with their licences.
cpSync(`${root}/src/assets/site/club`, `${root}/dist/club`, { recursive: true });
for (const file of ["robots.txt", "sitemap.xml"]) cpSync(`${root}/src/assets/site/${file}`, `${root}/dist/${file}`);
cpSync(`${root}/node_modules/meshoptimizer/LICENSE.md`, `${root}/dist/club/meshoptimizer-MIT.txt`);
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
