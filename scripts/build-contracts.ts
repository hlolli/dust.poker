// Compiles every contracts/*.compact into contracts/build/<name>/ with the pinned compactc.
// Always emits ZKIR v3, the format the wasm prover (midnight-zkir 3.x) consumes.
//
// Pass --zk to also generate prover and verifier keys. Keys are made by the `zkir` built
// from the same source as the wasm prover (scripts/build-prover.sh), not by the zkir-v3
// binary bundled with compactc: same version string, different key file format.
import { $ } from "bun";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  // compactc empties its output directory; keys cost half a minute and 3 GB to make, so a
  // plain build keeps the ones it finds. They are stale if the circuits changed: use --zk then.
  const stash = `${out}.keys`;
  if (existsSync(stash)) {
    // Left by a build that failed before restoring: put it back, or drop it if newer keys exist.
    if (existsSync(`${out}/keys`)) rmSync(stash, { recursive: true, force: true });
    else renameSync(stash, `${out}/keys`);
  }
  const keep = !zk && existsSync(`${out}/keys`);
  if (keep) renameSync(`${out}/keys`, stash);
  try {
    await $`${compactc} --feature-zkir-v3 --skip-zk ${root}/contracts/${f} ${out}`;
  } finally {
    if (keep) renameSync(stash, `${out}/keys`);
  }
  if (zk) {
    console.log(`zkir compile-many -> contracts/build/${name}/keys`);
    await $`${prover}/bin/zkir compile-many ${out}/zkir ${out}/keys`.env({ ...process.env, MIDNIGHT_PP: `${prover}/params` });
    writeFileSync(`${out}/keys/.zkir-hash`, zkirHash(out));
  } else if (existsSync(`${out}/keys`) && (!existsSync(`${out}/keys/.zkir-hash`) || readFileSync(`${out}/keys/.zkir-hash`, "utf8").trim() !== zkirHash(out))) {
    // Stale keys prove nothing: the prover reports an unsatisfied constraint system, hours later, on a chain.
    console.warn(`WARNING: contracts/build/${name}/keys were made from other circuits than these; run compact:build --zk`);
  }
}

/** One hash over every circuit's IR: what the keys were made from. */
function zkirHash(out: string): string {
  const h = new Bun.CryptoHasher("sha256");
  for (const f of readdirSync(`${out}/zkir`).sort()) h.update(readFileSync(`${out}/zkir/${f}`));
  return h.digest("hex");
}
