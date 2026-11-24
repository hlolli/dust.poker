export function serveSite() {
  const dist = new URL("../dist/", import.meta.url);
  return Bun.serve({
    hostname: "127.0.0.1", port: 0, idleTimeout: 60,
    fetch(req) {
      const path = new URL(req.url).pathname.slice(1) || "index.html";
      if (!/^(?:club\/)?[\w-]+[\w.-]*$/.test(path)) return new Response(null, { status: 404 });
      return new Response(Bun.file(new URL(path, dist)));
    },
  });
}
