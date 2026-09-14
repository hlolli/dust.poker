// Compiles every contracts/*.compact into contracts/build/<name>/ with the pinned compactc.
// Pass --zk to also generate prover and verifier keys (slow; only needed to prove).
import { $ } from "bun";
import { readdirSync } from "node:fs";
import pkg from "../package.json";

const root = `${import.meta.dir}/..`;
const compactc = `${root}/.compact/${pkg.config.compactc}/compactc`;
const zk = process.argv.includes("--zk");

await $`bun ${root}/scripts/fetch-compact.ts`.quiet();

const sources = readdirSync(`${root}/contracts`).filter((f) => f.endsWith(".compact"));
for (const f of sources) {
  const name = f.replace(/\.compact$/, "");
  const out = `${root}/contracts/build/${name}`;
  console.log(`compactc ${f} -> contracts/build/${name}${zk ? "" : " (--skip-zk)"}`);
  const args = zk ? [] : ["--skip-zk"];
  await $`${compactc} ${args} ${root}/contracts/${f} ${out}`;
}
