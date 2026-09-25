import { expect, test } from "bun:test";
import { type Change, watchContract } from "./indexer.ts";

// A stand-in indexer speaking graphql-transport-ws: it must be greeted, acknowledges, takes one
// subscription, and is answered when it pings. Then it pushes two actions and completes; the
// watcher reconnects and is greeted again.

test("the contract watcher speaks graphql-transport-ws and reconnects", async () => {
  const log: string[] = [];
  const changes: Change[] = [];
  let connections = 0;
  const server = Bun.serve<undefined>({
    port: 0,
    fetch(req, srv) {
      expect(req.headers.get("sec-websocket-protocol")).toBe("graphql-transport-ws");
      return srv.upgrade(req, { headers: { "sec-websocket-protocol": "graphql-transport-ws" } }) ? undefined : new Response("no", { status: 400 });
    },
    websocket: {
      open() {
        connections++;
      },
      message(ws, raw) {
        const msg = JSON.parse(String(raw)) as { type: string; id?: string; payload?: { query?: string; variables?: { address?: string } } };
        log.push(msg.type);
        if (msg.type === "connection_init") {
          ws.send(JSON.stringify({ type: "connection_ack" }));
          ws.send(JSON.stringify({ type: "ping" }));
        } else if (msg.type === "subscribe") {
          expect(msg.payload?.query).toContain("contractActions(address: $address)");
          expect(msg.payload?.variables?.address).toBe("ab".repeat(32));
          if (connections === 1) {
            for (const n of [1, 2]) ws.send(JSON.stringify({ id: msg.id, type: "next", payload: { data: { contractActions: { state: `0${n}`, transaction: { block: { timestamp: (1_700_000_000 + n) * 1000, ledgerParameters: "00" } } } } } }));
            ws.send(JSON.stringify({ id: msg.id, type: "complete" }));
          }
        }
      },
    },
  });
  const errors: unknown[] = [];
  const stop = watchContract(`ws://localhost:${server.port}`, "ab".repeat(32), (c) => changes.push(c), (e) => errors.push(e));
  const until = (ok: () => boolean) => new Promise<void>((r, j) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (ok()) (clearInterval(iv), r());
      else if (Date.now() - t0 > 5000) (clearInterval(iv), j(new Error(`timed out: ${log.join(",")}`)));
    }, 10);
  });
  await until(() => changes.length === 2 && connections === 2 && log.filter((t) => t === "connection_init").length === 2);
  expect(changes.map((c) => c.state)).toEqual(["01", "02"]);
  expect(changes[1]!.block.timestamp).toBe(1_700_000_002);
  expect(log.filter((t) => t === "pong").length).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
  stop();
  await new Promise((r) => setTimeout(r, 50));
  const before = connections;
  await new Promise((r) => setTimeout(r, 200));
  expect(connections).toBe(before); // stopped: no more reconnects
  server.stop(true);
}, 15_000);
