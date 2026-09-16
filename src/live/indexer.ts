// What a Live table reads from the chain, through the indexer the wallet uses (its GraphQL API,
// schema v4): the latest block, for its time and the ledger parameters a transaction is
// partitioned against, and the referee's current state.

export type Snapshot = {
  block: { hash: string; height: number; timestamp: number; ledgerParameters: string };
  /** The contract's serialized state, hex; null when nothing is deployed at the address. */
  state: string | null;
};

const QUERY = `query ($address: HexEncoded!) {
  block { hash height timestamp ledgerParameters }
  contractAction(address: $address) { state }
}`;

/** One request, so the block and the state come from the same moment. */
export async function snapshot(indexerUri: string, address: string): Promise<Snapshot> {
  const res = await fetch(indexerUri, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: QUERY, variables: { address } }) });
  if (!res.ok) throw new Error(`indexer ${res.status} ${res.statusText}`);
  const { data, errors } = (await res.json()) as { data?: { block: Snapshot["block"]; contractAction: { state: string } | null }; errors?: { message: string }[] };
  if (errors?.length || !data) throw new Error(`indexer: ${errors?.map((e) => e.message).join("; ") ?? "no data"}`);
  return { block: data.block, state: data.contractAction?.state ?? null };
}
