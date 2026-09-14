// Fetches the pinned Compact compiler into .compact/<version>/ for this platform.
// Version lives in package.json "config.compactc". Same script runs in CI.
import { $ } from "bun";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import pkg from "../package.json";

const version: string = pkg.config.compactc;
const dir = `${import.meta.dir}/../.compact/${version}`;
const bin = `${dir}/compactc`;

if (existsSync(bin)) {
  console.log(`compactc ${version} already at ${bin}`);
  process.exit(0);
}

const target = {
  "darwin-arm64": "aarch64-darwin",
  "darwin-x64": "x86_64-darwin",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "linux-x64": "x86_64-unknown-linux-musl",
}[`${process.platform}-${process.arch}`];
if (!target) throw new Error(`no compactc build for ${process.platform}-${process.arch}`);

const asset = `compactc_v${version}_${target}.zip`;
const url = `https://github.com/midnightntwrk/compact/releases/download/compactc-v${version}/${asset}`;
console.log(`fetching ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
await mkdir(dir, { recursive: true });
const zip = `${dir}/${asset}`;
await Bun.write(zip, await res.arrayBuffer());
await $`unzip -q -o ${zip} -d ${dir}`;
await $`rm ${zip}`;
if (!existsSync(bin)) throw new Error(`unzip finished but ${bin} is missing; contents: ${(await $`ls ${dir}`.text()).trim()}`);
console.log(`compactc ${version} at ${bin}`);
