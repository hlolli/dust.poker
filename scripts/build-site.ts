// Builds the static site into dist/ with the wasm shim plugin (the CLI `bun build` takes no
// plugins). Run `bun run compact:build` first: the referee imports the compiled contract.
import plugin from "./wasm-plugin.ts";

const root = `${import.meta.dir}/..`;
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
