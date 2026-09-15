// Compiles every contracts/*.compact into contracts/build/<name>/ with the pinned compactc.
// Always emits ZKIR v3, the format the wasm prover (midnight-zkir 3.x) consumes.
//
// Pass --zk to also generate prover and verifier keys. Keys are made by the `zkir` built
// from the same source as the wasm prover (scripts/build-prover.sh), not by the zkir-v3
// binary bundled with compactc: same version string, different key file format.
import { $ } from "bun";
import { existsSync, readdirSync } from "node:fs";
import pkg from "../package.json";

const root = `${import.meta.dir}/..`;
const compactc = `${root}/.compact/${pkg.config.compactc}/compactc`;
const prover = `${root}/.compact/prover`;
const zk = process.argv.includes("--zk");

await $`bun ${root}/scripts/fetch-compact.ts`.quiet();
if (zk && !existsSync(`${prover}/bin/zkir`)) {
  console.error(`--zk needs ${prover}/bin/zkir; run scripts/build-prover.sh first`);
  process.exit(1);
}

const sources = readdirSync(`${root}/contracts`).filter((f) => f.endsWith(".compact"));
for (const f of sources) {
  const name = f.replace(/\.compact$/, "");
  const out = `${root}/contracts/build/${name}`;
  console.log(`compactc ${f} -> contracts/build/${name}`);
  await $`${compactc} --feature-zkir-v3 --skip-zk ${root}/contracts/${f} ${out}`;
  if (zk) {
    console.log(`zkir compile-many -> contracts/build/${name}/keys`);
    await $`${prover}/bin/zkir compile-many ${out}/zkir ${out}/keys`.env({ ...process.env, MIDNIGHT_PP: `${prover}/params` });
  }
}
