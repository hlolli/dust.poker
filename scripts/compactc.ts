import { $ } from "bun";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** Compile with the pinned toolchain; both paths are relative to the caller. */
export async function compileContract(compiler: string, source: string, out: string): Promise<void> {
  const toolchain = dirname(resolve(compiler));
  const temporary = mkdtempSync(join(resolve(tmpdir()), "compactc-"));
  try {
    // The release's Chez launcher ignores TMPDIR and writes its boot images to /tmp:
    // https://github.com/tkerber/chez-exe/blob/c461925100efc25ada0e3f3b0844bdf1ba337b51/embed_target.c
    // Make only those two paths relative in a disposable copy, then run it inside TMPDIR.
    // Reject an unfamiliar layout rather than modifying arbitrary compiler bytes.
    const bytes = readFileSync(join(toolchain, "compactc.bin"));
    for (const name of ["chezschemeboot", "schemeprogram"]) {
      const pattern = Buffer.from(`/tmp/${name}XXXXXX\0`);
      const offset = bytes.indexOf(pattern);
      if (offset < 0 || bytes.indexOf(pattern, offset + 1) >= 0) {
        throw new Error(`Unsupported Compact launcher: expected one ${pattern.toString().slice(0, -1)}`);
      }
      bytes.fill(0, offset, offset + pattern.length);
      bytes.write(`./${name}XXXXXX`, offset);
    }
    const binary = join(temporary, "compactc");
    writeFileSync(binary, bytes, { mode: 0o700 });
    // The two path changes invalidate the release's ad-hoc Mach-O signature.
    if (process.platform === "darwin") await $`/usr/bin/codesign --force --sign - ${binary}`.quiet();
    await $`${binary} --skip-zk ${resolve(source)} ${resolve(out)}`
      .cwd(temporary)
      .env({ ...process.env, PATH: `${toolchain}:${process.env.PATH ?? ""}` });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
