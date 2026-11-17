// A player's local proof server, using Ledger 9's request framing and the contract's
// released ZKIR v3 keys. The network integration test exercises the same HTTP protocol as Lace.
import * as L from "@midnightntwrk/ledger-v9";

export function proofServer(url: string, keys: Pick<L.ProvingProvider, "lookupKey">): L.ProvingProvider {
  const request = async (path: string, payload: Uint8Array) => {
    const res = await fetch(new URL(path, url), { method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(payload), signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`proof server ${path}: ${res.status} ${(await res.text()).slice(0, 2000)}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  return {
    lookupKey: (key) => keys.lookupKey(key),
    check: async (preimage, key) => L.parseCheckResult(await request("/check", L.createCheckPayload(preimage, (await keys.lookupKey(key))?.ir))),
    prove: async (preimage, key, binding) => request("/prove", L.createProvingPayload(preimage, binding, await keys.lookupKey(key))),
  };
}
