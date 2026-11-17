import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import pkg from "../package.json";
import { compileContract } from "./compactc.ts";

const compiler = `${import.meta.dir}/../.compact/${pkg.config.compactc}/compactc`;

test("Compact compiles using the configured temporary directory and preserves the download", async () => {
  const dir = mkdtempSync(join(tmpdir(), "compact build test "));
  const previous = process.env.TMPDIR;
  const temporary = join(dir, "temporary files");
  const source = join(dir, "counter.compact");
  const out = join(dir, "compiled contract");
  const original = readFileSync(`${compiler}.bin`);
  mkdirSync(temporary);
  process.env.TMPDIR = temporary;
  try {
    writeFileSync(join(dir, "state.compact"), "export ledger count: Counter;\n");
    writeFileSync(source, `import CompactStandardLibrary;
include "state";
export circuit increment(): [] { count.increment(1); }
`);
    await compileContract(compiler, relative(process.cwd(), source), relative(process.cwd(), out));
    expect(readFileSync(join(out, "contract/index.js"), "utf8")).toContain("increment");
    expect(readFileSync(join(out, "zkir/increment.zkir"), "utf8").length).toBeGreaterThan(0);
    expect(readdirSync(temporary)).toEqual([]);
    expect(readFileSync(`${compiler}.bin`).equals(original)).toBe(true);

    // A bad source must still fail, and cleanup must also run on that path.
    writeFileSync(source, "this is not Compact;\n");
    await expect(compileContract(compiler, source, out)).rejects.toThrow();
    expect(readdirSync(temporary)).toEqual([]);

    // Do not silently fall back to /tmp if the configured location is unavailable.
    process.env.TMPDIR = join(dir, "missing directory");
    await expect(compileContract(compiler, source, out)).rejects.toThrow("ENOENT");
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test("Compact rejects missing or ambiguous bootstrap paths before executing the copy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "compact layout test "));
  const previous = process.env.TMPDIR;
  const temporary = join(dir, "temporary files");
  mkdirSync(temporary);
  process.env.TMPDIR = temporary;
  try {
    const fake = join(dir, "compactc");
    for (const bytes of ["unknown launcher", "/tmp/chezschemebootXXXXXX\0/tmp/chezschemebootXXXXXX\0/tmp/schemeprogramXXXXXX\0"]) {
      writeFileSync(`${fake}.bin`, bytes);
      await expect(compileContract(fake, "unused.compact", "unused output")).rejects.toThrow("Unsupported Compact launcher");
      expect(readdirSync(temporary)).toEqual([]);
    }
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
