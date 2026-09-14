import plugin from "./wasm-plugin.ts";

const result = await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  plugins: [plugin],
});
for (const l of result.logs) console.log(l);
for (const o of result.outputs) console.log(o.path, o.size);
if (!result.success) process.exit(1);
