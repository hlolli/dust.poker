// Bundles the page with the wasm shims and copies keys, IR and params into dist/assets.
import { cp, mkdir, readdir } from "node:fs/promises";
import { wasmShims } from "./wasm-plugin.ts";

const zkirWasm = process.env.ZKIR_WASM;
const keys = process.env.KEYS;
const zkirDir = process.env.ZKIR;
const params = process.env.PARAMS ?? `${import.meta.dir}/../../.compact/params`;
if (!zkirWasm || !keys || !zkirDir) throw new Error("set ZKIR_WASM, KEYS and ZKIR");

const result = await Bun.build({
  entrypoints: [`${import.meta.dir}/index.html`, `${import.meta.dir}/index-mt.html`, `${import.meta.dir}/worker-mt.ts`],
  outdir: `${import.meta.dir}/dist`,
  // Entry names unhashed so the page can spawn `new Worker("/worker-mt.js")`.
  naming: { entry: "[name].[ext]", chunk: "chunk-[hash].[ext]", asset: "[name]-[hash].[ext]" },
  plugins: [wasmShims(zkirWasm)],
});
for (const l of result.logs) console.log(l);
if (!result.success) process.exit(1);

const assets = `${import.meta.dir}/dist/assets`;
await mkdir(assets, { recursive: true });
for (const dir of [keys, zkirDir, params]) {
  for (const f of await readdir(dir)) await cp(`${dir}/${f}`, `${assets}/${f}`);
}
console.log(`built; assets: ${(await readdir(assets)).join(", ")}`);
