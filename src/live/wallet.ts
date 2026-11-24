// The player's wallet: Lace, or any wallet speaking Midnight's DApp connector API 4.x
// (github.com/midnightntwrk/midnight-dapp-connector-api). Wallets inject an InitialAPI under
// window.midnight[<their id>] (Lace: mnLace); the API says to enumerate, not to name one.
// Only the part of the API used here is typed; the package is types only, so nothing to install.

export type InitialAPI = {
  rdns: string;
  name: string;
  icon: string;
  /** The connector API version the wallet implements, e.g. "4.1.0". */
  apiVersion: string;
  /** Opens the wallet's consent dialog; resolves when the user has agreed. */
  connect(networkId: string): Promise<ConnectedAPI>;
};

export type Configuration = { indexerUri: string; indexerWsUri: string; substrateNodeUri: string; networkId: string };

/** Resolves a circuit's proving artifacts for the wallet's prover, by the key location our transactions name (the circuit). */
export type KeyMaterialProvider = {
  getZKIR(circuitKeyLocation: string): Promise<Uint8Array>;
  getProverKey(circuitKeyLocation: string): Promise<Uint8Array>;
  getVerifierKey(circuitKeyLocation: string): Promise<Uint8Array>;
};

/** The ledger's ProvingProvider shape, as the wallet lends it. */
export type ProvingProvider = {
  check(serializedPreimage: Uint8Array, keyLocation: string): Promise<(bigint | undefined)[]>;
  prove(serializedPreimage: Uint8Array, keyLocation: string, overwriteBindingInput?: bigint): Promise<Uint8Array>;
};

export type ConnectedAPI = {
  /** Bech32m, mn_addr_<network>1... (mainnet: mn_addr1...). */
  getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>;
  getDustBalance?(): Promise<{ balance: bigint; cap: bigint }>;
  /** The indexer and node configured by the wallet. */
  getConfiguration(): Promise<Configuration>;
  /** Takes a proven, unbound transaction (hex), adds the inputs it is short of and the fee, signs. */
  balanceUnsealedTransaction(tx: string, options?: { payFees?: boolean }): Promise<{ tx: string }>;
  /** Submits a balanced, sealed transaction (hex) to the network. */
  submitTransaction(tx: string): Promise<void>;
  /** The wallet's own prover: the player's software, so a user-controlled prover (ADR 0005). */
  getProvingProvider(keys: KeyMaterialProvider): Promise<ProvingProvider>;
};

declare global {
  interface Window {
    midnight?: Record<string, InitialAPI>;
  }
}

export type Wallet = {
  name: string;
  networkId: string;
  /** The unshielded address as the wallet shows it. */
  address: string;
  /** The same address as the 32 bytes the contract's `join` records as the seat's payout address. */
  payout: Uint8Array;
  config: Configuration;
  api: ConnectedAPI;
};

/**
 * The networks a Live table can be on: Midnight's public test networks, and on a development
 * machine the local one (local/README). Mainnet waits until real money has been worked out.
 */
export const isLocalSite = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1";
export const NETWORKS = ["preview", "preprod", ...(isLocalSite(globalThis.location?.hostname ?? "") ? ["undeployed"] : [])];
export const PREVIEW_INDEXER = "https://indexer.preview.midnight.network/api/v4/graphql";

/** The network the page asks the wallet for first: `?network=<id>` (a shared table's link carries it), or Preview. */
export const network = () => new URLSearchParams(location.search).get("network") ?? NETWORKS[0]!;

/** Wallets in this browser that speak connector API 4.x. */
export const installed = (): InitialAPI[] => Object.values(window.midnight ?? {}).filter((w) => w?.apiVersion?.startsWith("4.") && typeof w.connect === "function");

/** Keep private/custom providers. Only replace known retired public endpoints. */
export function liveConfiguration(config: Configuration): Configuration {
  if (config.networkId !== "preview" && config.networkId !== "preprod") return config;
  const preprod = config.networkId === "preprod";
  const retired = (url: URL) => url.hostname === "blockfrost.lw.iog.io" ||
    (preprod && ["rpc.preprod.midnight.network", "indexer.preprod.midnight.network"].includes(url.hostname));
  const node = new URL(config.substrateNodeUri);
  const indexer = new URL(config.indexerUri);
  const ws = new URL(config.indexerWsUri);
  if (retired(node)) throw new Error(`The wallet's ${config.networkId} node has retired. Update the node and indexer in Lace using Wallet setup, then reconnect.`);
  if (preprod) {
    if ([indexer, ws].some(retired)) throw new Error("The Preprod indexer has retired. Set the Blockfrost Preprod indexer and project ID in Lace, then reconnect.");
    if ([node, indexer, ws].some(url => ["midnight-preprod.blockfrost.io", "rpc.midnight-preprod.blockfrost.io"].includes(url.hostname) && !url.searchParams.get("project_id"))) {
      throw new Error("The Blockfrost Preprod endpoint needs a Midnight Preprod project ID. Add it in Lace, then reconnect.");
    }
  } else if ([indexer, ws].some(retired)) {
    return { ...config, indexerUri: PREVIEW_INDEXER, indexerWsUri: PREVIEW_INDEXER.replace("https:", "wss:") + "/ws" };
  }
  return config;
}

/** Connects, and checks the wallet is on the network asked for. */
export async function connect(wallet: InitialAPI, networkId = network()): Promise<Wallet> {
  if (!NETWORKS.includes(networkId)) throw new Error(`unsupported Live network: ${networkId}; choose ${NETWORKS.join(" or ")}`);
  const api = await wallet.connect(networkId);
  const settings = await api.getConfiguration();
  if (settings.networkId !== networkId) throw new Error(`the wallet is on ${settings.networkId}, not ${networkId}`);
  const config = liveConfiguration(settings);
  if (typeof api.getProvingProvider !== "function" || typeof api.balanceUnsealedTransaction !== "function" || typeof api.submitTransaction !== "function") {
    throw new Error("Update Lace to a Ledger 9 version with proving and transaction submission.");
  }
  const { unshieldedAddress } = await api.getUnshieldedAddress();
  const { kind, network: addressNetwork, bytes } = decodeAddress(unshieldedAddress);
  if (kind !== "addr" || bytes.length !== 32 || addressNetwork !== networkId) throw new Error(`not an unshielded ${networkId} address: ${unshieldedAddress}`);
  return { name: wallet.name, networkId, address: unshieldedAddress, payout: bytes, config, api };
}

// ---- Bech32m (BIP-350), as Midnight formats addresses: mn_<kind>[_<network>]1<data><checksum> --------

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32M = 0x2bc830a3;

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATOR[i]!;
  }
  return chk >>> 0;
}

/** Decodes a Midnight Bech32m string into its kind ("addr", "shield-addr", "dust"), network and bytes. */
export function decodeAddress(s: string): { kind: string; network: string; bytes: Uint8Array } {
  const lower = s.toLowerCase();
  if (s !== lower && s !== s.toUpperCase()) throw new Error("mixed-case address");
  const sep = lower.lastIndexOf("1");
  if (sep < 1 || lower.length - sep < 7) throw new Error("not a Bech32m string");
  const hrp = lower.slice(0, sep);
  const words = [...lower.slice(sep + 1)].map((c) => CHARSET.indexOf(c));
  if (words.includes(-1)) throw new Error("bad character in address");
  const expanded = [...hrp].map((c) => c.charCodeAt(0) >>> 5).concat(0, [...hrp].map((c) => c.charCodeAt(0) & 31));
  if (polymod(expanded.concat(words)) !== BECH32M) throw new Error("bad address checksum");
  // Five-bit words to bytes; the pad must be under five bits and zero.
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const w of words.slice(0, -6)) {
    acc = ((acc << 5) | w) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >>> bits) & 0xff);
    }
  }
  if (bits >= 5 || acc & ((1 << bits) - 1)) throw new Error("bad address padding");
  const [prefix, kind, network = "mainnet"] = hrp.split("_");
  if (prefix !== "mn" || !kind) throw new Error(`not a Midnight address: ${hrp}`);
  return { kind, network, bytes: Uint8Array.from(bytes) };
}
