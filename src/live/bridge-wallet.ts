// A wallet over HTTP for trying the Live table without Lace: local/bridge.ts serves a seed
// wallet on the undeployed network on this machine, and this puts it under window.midnight
// with the DApp connector's shape, so the menu connects to it like any wallet. Installed only
// when the page is opened with ?wallet=<its URL>; it refuses every network but undeployed.
import type { ConnectedAPI, InitialAPI, KeyMaterialProvider, ProvingProvider } from "./wallet.ts";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const bytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

export function installBridge(url: string): void {
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${url}${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`bridge wallet: ${path} ${res.status}`);
    const data = (await res.json()) as T & { error?: string };
    if (data.error) throw new Error(data.error);
    return data;
  };
  const api: ConnectedAPI = {
    getUnshieldedAddress: () => call("/address"),
    getConfiguration: () => call("/config"),
    balanceUnsealedTransaction: (tx) => call("/balance", { tx }),
    submitTransaction: (tx) => call("/submit", { tx }).then(() => undefined),
    // The bridge proves with its own copy of the keys; the site's are not sent over.
    getProvingProvider: async (_keys: KeyMaterialProvider): Promise<ProvingProvider> => ({
      check: async (preimage, key) => (await call<{ inputs: (string | null)[] }>("/check", { preimage: hex(preimage), key })).inputs.map((x) => (x === null ? undefined : BigInt(x))),
      prove: async (preimage, key, binding) => bytes((await call<{ proof: string }>("/prove", { preimage: hex(preimage), key, binding: binding === undefined ? undefined : String(binding) })).proof),
    }),
  };
  const wallet: InitialAPI = {
    rdns: "poker.dust.bridge",
    name: "Seed wallet (bridge)",
    icon: "",
    apiVersion: "4.0.0",
    async connect(networkId) {
      if (networkId !== "undeployed") throw new Error("the bridge wallet is on the undeployed network only");
      return api;
    },
  };
  window.midnight = { ...window.midnight, bridge: wallet };
}
