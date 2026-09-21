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

/** A contract action as the subscription delivers it: the state after it, and the block it landed in. */
export type Change = { state: string; block: { timestamp: number; ledgerParameters: string } };

const SUBSCRIPTION = `subscription ($address: HexEncoded!) {
  contractActions(address: $address) { state transaction { block { timestamp ledgerParameters } } }
}`;

/**
 * Follows the referee on the indexer's WebSocket: every action on the contract, from the
 * latest block on, as it is indexed. Speaks graphql-transport-ws (the graphql-ws protocol) by
 * hand: init, ack, one subscribe, then next messages, pings answered; the server's messages
 * are data, and anything unexpected is dropped. Reconnects with a growing pause after a
 * close, since the indexer is the only channel a Live table has. Returns the way to stop.
 */
export function watchContract(wsUri: string, address: string, onChange: (c: Change) => void, onError: (e: unknown) => void = () => {}): () => void {
  let socket: WebSocket | null = null;
  let stopped = false;
  let backoff = 1000;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const open = () => {
    if (stopped) return;
    const ws = new WebSocket(wsUri, "graphql-transport-ws");
    socket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "connection_init" }));
    ws.onmessage = (ev) => {
      let msg: { type?: string; id?: string; payload?: unknown };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      switch (msg.type) {
        case "connection_ack":
          backoff = 1000;
          ws.send(JSON.stringify({ id: "1", type: "subscribe", payload: { query: SUBSCRIPTION, variables: { address } } }));
          break;
        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;
        case "next": {
          const data = (msg.payload as { data?: { contractActions?: { state?: string; transaction?: { block?: Change["block"] } } } } | undefined)?.data?.contractActions;
          if (data && typeof data.state === "string" && data.transaction?.block) onChange({ state: data.state, block: data.transaction.block });
          break;
        }
        case "error":
          onError(new Error(`indexer subscription: ${JSON.stringify(msg.payload)}`));
          break;
        case "complete":
          ws.close();
          break;
      }
    };
    ws.onerror = () => onError(new Error("indexer WebSocket error"));
    ws.onclose = () => {
      if (stopped || socket !== ws) return;
      retry = setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 30_000);
    };
  };
  open();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    socket?.close();
  };
}

/** One request, so the block and the state come from the same moment. */
export async function snapshot(indexerUri: string, address: string): Promise<Snapshot> {
  const res = await fetch(indexerUri, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: QUERY, variables: { address } }) });
  if (!res.ok) throw new Error(`indexer ${res.status} ${res.statusText}`);
  const { data, errors } = (await res.json()) as { data?: { block: Snapshot["block"]; contractAction: { state: string } | null }; errors?: { message: string }[] };
  if (errors?.length || !data) throw new Error(`indexer: ${errors?.map((e) => e.message).join("; ") ?? "no data"}`);
  return { block: data.block, state: data.contractAction?.state ?? null };
}
