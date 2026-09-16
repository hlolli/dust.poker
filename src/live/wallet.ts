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

export type ConnectedAPI = {
  /** Bech32m, mn_addr_<network>1... (mainnet: mn_addr1...). */
  getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>;
  /** The indexer and node the wallet talks to; the game uses the same ones. */
  getConfiguration(): Promise<Configuration>;
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

// ponytail: ledger 9 (Compact 0.34) is not on a public network yet; the default is the local
// node from Midnight's docker setup. Change with ?network=<id> or here when the contract deploys.
export const DEFAULT_NETWORK = "undeployed";

/** The network the page asks the wallet for: `?network=<id>`, or the default. */
export const network = () => new URLSearchParams(location.search).get("network") ?? DEFAULT_NETWORK;

/** Wallets in this browser that speak connector API 4.x. */
export const installed = (): InitialAPI[] => Object.values(window.midnight ?? {}).filter((w) => w.apiVersion.startsWith("4."));

/** Connects, and checks the wallet is on the network asked for. */
export async function connect(wallet: InitialAPI, networkId = network()): Promise<Wallet> {
  const api = await wallet.connect(networkId);
  const [config, { unshieldedAddress }] = await Promise.all([api.getConfiguration(), api.getUnshieldedAddress()]);
  if (config.networkId !== networkId) throw new Error(`the wallet is on ${config.networkId}, not ${networkId}`);
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
