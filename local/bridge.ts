// A wallet for the browser without Lace: the seed wallet of local/wallet.ts behind HTTP on this
// machine, and the site's src/live/bridge-wallet.ts puts it under window.midnight when the page
// is opened with ?wallet=http://127.0.0.1:8790. Test only, undeployed network only: the seed is
// a genesis one and the server answers anyone on this machine.
//
//   bun local/bridge.ts               # seed 00..02
//   bun local/bridge.ts --seed 3      # another genesis wallet, --port for another port
import { parseArgs } from "node:util";
import { bytes, hex, scriptWallet, seed } from "./wallet.ts";

const { values } = parseArgs({ options: { seed: { type: "string", default: "2" }, port: { type: "string", default: "8790" } } });
const wallet = await scriptWallet(`seed ${values.seed}`, seed(Number(values.seed)));
const prover = await wallet.api.getProvingProvider({ getZKIR: async () => new Uint8Array(), getProverKey: async () => new Uint8Array(), getVerifierKey: async () => new Uint8Array() });
const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "content-type": "application/json" };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers });
const failing = (e: unknown) => json({ error: e instanceof Error ? e.message : String(e) });

Bun.serve({
  port: Number(values.port),
  hostname: "127.0.0.1",
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { headers });
    const path = new URL(req.url).pathname;
    try {
      if (path === "/address") return json({ unshieldedAddress: wallet.address });
      if (path === "/config") return json(wallet.config);
      const body = req.method === "POST" ? ((await req.json()) as { tx?: string; preimage?: string; key?: string; binding?: string }) : {};
      if (path === "/balance") return json(await wallet.api.balanceUnsealedTransaction(body.tx!));
      if (path === "/submit") return json(await wallet.api.submitTransaction(body.tx!).then(() => ({})));
      if (path === "/check") return json({ inputs: (await prover.check(bytes(body.preimage!), body.key!)).map((x) => (x === undefined ? null : String(x))) });
      if (path === "/prove") return json({ proof: hex(await prover.prove(bytes(body.preimage!), body.key!, body.binding === undefined ? undefined : BigInt(body.binding))) });
      return new Response("not found", { status: 404, headers });
    } catch (e) {
      console.error(path, e instanceof Error ? e.message : e);
      return failing(e);
    }
  },
});
console.log(`bridge wallet ${wallet.address} on http://127.0.0.1:${values.port}; open the site with ?wallet=http://127.0.0.1:${values.port}`);
