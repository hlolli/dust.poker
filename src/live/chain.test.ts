import { expect, test } from "bun:test";
import { jsonIrToBinary, Zkir } from "@midnightntwrk/zkir-v3";
import { keyMaterial } from "./chain.ts";

test("the wallet receives binary ZKIR v3 matching the compiled circuit", async () => {
  const root = `${import.meta.dir}/../../contracts/build/deal`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path !== "/zkir/join.zkir" && path !== "/zkir/join.bzkir") return new Response(null, { status: 404 });
      return new Response(Bun.file(`${root}${path}`));
    },
  });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: { search: `?keys=${encodeURIComponent(server.url.href.slice(0, -1))}` } });
  try {
    const ir = await keyMaterial.getZKIR("join");
    expect(Zkir.deserialize(ir).getK()).toBeGreaterThan(0);
    const expected = jsonIrToBinary(await Bun.file(`${root}/zkir/join.zkir`).text());
    expect(Buffer.from(ir).equals(expected)).toBe(true);
  } finally {
    if (previous) Object.defineProperty(globalThis, "location", previous);
    else Reflect.deleteProperty(globalThis, "location");
    server.stop(true);
  }
});
