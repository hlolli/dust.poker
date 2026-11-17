// The released ZKIR v3 prover and Compact's bundled zkir-v3 use the same key format.
// Keep public parameters in the existing cache; both key generation and proving read them.
import { mkdirSync } from "node:fs";

export const paramsDir = `${import.meta.dir}/../.compact/prover/params`;

export async function getParams(k: number, dir = paramsDir): Promise<Uint8Array> {
  const file = Bun.file(`${dir}/bls_midnight_2p${k}`);
  if (!(await file.exists())) {
    const res = await fetch(`https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com/bls_midnight_2p${k}`);
    if (!res.ok) throw new Error(`prover parameters k=${k}: ${res.status}`);
    mkdirSync(dir, { recursive: true });
    await Bun.write(file, await res.arrayBuffer());
  }
  return file.bytes();
}

if (import.meta.main) {
  const dir = process.argv[2] ? `${process.argv[2]}/params` : paramsDir;
  for (let k = 0; k <= 18; k++) await getParams(k, dir);
  console.log(`Released ZKIR v3 prover installed by Bun; public parameters ready at ${dir}`);
}
