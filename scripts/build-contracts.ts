// Compiles every contracts/*.compact into contracts/build/<name>/ with the pinned compactc.
// Compact 0.36 emits ZKIR v3, the format the released @midnightntwrk/zkir-v3 consumes.
//
// Pass --zk to generate matching prover and verifier keys with the bundled zkir-v3.
import { $ } from "bun";
import { jsonIrToBinary, Zkir } from "@midnightntwrk/zkir-v3";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import pkg from "../package.json";
import { compileContract } from "./compactc.ts";
import { getParams, paramsDir } from "./prover.ts";

const root = `${import.meta.dir}/..`;
const compactc = `${root}/.compact/${pkg.config.compactc}/compactc`;
const keygen = `${root}/.compact/${pkg.config.compactc}/zkir-v3`;
const zk = process.argv.includes("--zk");

await $`bun ${root}/scripts/fetch-compact.ts`.quiet();

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
    await compileContract(compactc, `${root}/contracts/${f}`, out);
  } finally {
    if (keep) renameSync(stash, `${out}/keys`);
  }
  // --skip-zk emits JSON only. Wallets need binary IR even when a plain rebuild kept the keys.
  for (const file of readdirSync(`${out}/zkir`).filter((f) => f.endsWith(".zkir"))) {
    writeFileSync(`${out}/zkir/${file.replace(/\.zkir$/, ".bzkir")}`, jsonIrToBinary(readFileSync(`${out}/zkir/${file}`, "utf8")));
  }
  if (zk) {
    const sizes = new Set(readdirSync(`${out}/zkir`).filter((f) => f.endsWith(".zkir")).map((f) => Zkir.fromJson(readFileSync(`${out}/zkir/${f}`, "utf8")).getK()));
    for (const k of sizes) await getParams(k);
    console.log(`zkir-v3 compile-many -> contracts/build/${name}/keys`);
    await $`${keygen} compile-many ${out}/zkir ${out}/keys`.env({ ...process.env, MIDNIGHT_PP: paramsDir });
    writeFileSync(`${out}/keys/.zkir-hash`, zkirHash(out));
  } else if (existsSync(`${out}/keys`) && (!existsSync(`${out}/keys/.zkir-hash`) || readFileSync(`${out}/keys/.zkir-hash`, "utf8").trim() !== zkirHash(out))) {
    // Stale keys prove nothing: the prover reports an unsatisfied constraint system, hours later, on a chain.
    console.warn(`WARNING: contracts/build/${name}/keys were made from other circuits than these; run compact:build --zk`);
  }
}

/** One hash over every circuit's IR: what the keys were made from. */
function zkirHash(out: string): string {
  const h = new Bun.CryptoHasher("sha256");
  for (const f of readdirSync(`${out}/zkir`).filter((f) => f.endsWith(".zkir")).sort()) h.update(readFileSync(`${out}/zkir/${f}`));
  return h.digest("hex");
}
