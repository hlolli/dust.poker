// Registration is a five-minute interval on Midnight. Fix the beacon round before
// anyone enters, leaving time after the on-chain cutoff for block propagation.
import { fetchBeacon, HttpChainClient, type ChainInfo } from "drand-client";

export const DRAW_SECONDS = 300;
const QUICKNET: ChainInfo = {
  public_key:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  hash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  groupHash: "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
  genesis_time: 1692803367,
  period: 3,
  schemeID: "bls-unchained-g1-rfc9380",
  metadata: { beaconID: "quicknet" },
};
export const drawTime = (round: number) => (round + 1) * DRAW_SECONDS + 60;
export const beaconRound = (round: number) => Math.ceil((drawTime(round) - QUICKNET.genesis_time) / QUICKNET.period) + 1;

const toHex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

export async function drawRandomness(round: number): Promise<string> {
  const expected = beaconRound(round);
  const client = new HttpChainClient({ baseUrl: `https://api.drand.sh/${QUICKNET.hash}`, info: async () => QUICKNET });
  const beacon = await fetchBeacon(client, expected);
  if (beacon.round !== expected || !/^[0-9a-f]{96}$/.test(beacon.signature)) throw new Error("Invalid seating beacon.");
  // Derive the seed from the verified signature, never from relay-supplied randomness.
  return toHex(
    await crypto.subtle.digest(
      "SHA-256",
      Uint8Array.from(beacon.signature.match(/../g)!, (x) => parseInt(x, 16)),
    ),
  );
}

// Hash-ranking yields a uniform random ordering (apart from a SHA-256 collision).
// Every entrant has the same fixed key, seed and round when computing the result.
export async function drawTables(network: string, round: number, players: string[], seed: string): Promise<string[][]> {
  if (
    !Number.isSafeInteger(round) ||
    round < 0 ||
    !/^[a-f0-9]{64}$/.test(seed) ||
    players.length > 1024 ||
    players.some((p) => !/^[a-f0-9]{64}$/.test(p)) ||
    new Set(players).size !== players.length
  ) {
    throw new Error("Invalid public draw.");
  }
  if (players.length < 4) return [];
  const prefix = `dust.poker/seating/v1/${network}/${round}/${seed}/`;
  const encoder = new TextEncoder();
  const ranked = await Promise.all(
    players.map(async (key) => ({
      key,
      rank: toHex(await crypto.subtle.digest("SHA-256", encoder.encode(prefix + key))),
    })),
  );
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  ranked.sort((a, b) => compare(a.rank, b.rank) || compare(a.key, b.key));
  const tables: string[][] = Array.from({ length: Math.max(2, Math.ceil(players.length / 6)) }, () => []);
  ranked.forEach(({ key }, i) => tables[i % tables.length]!.push(key));
  return tables;
}
