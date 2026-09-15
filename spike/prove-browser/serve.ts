// Static server for the proving spikes with the headers threads need.
//   bun serve.ts [port]   serves dist/ and, at /prover-mt/, the threaded prover package.
const port = Number(process.argv[2] ?? 3003);
const dist = `${import.meta.dir}/dist`;
const proverMt = `${import.meta.dir}/../../.compact/prover-mt`;

const types: Record<string, string> = {
  ".wasm": "application/wasm",
  ".js": "text/javascript",
  ".html": "text/html",
  ".json": "application/json",
  ".zkir": "application/json",
};

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path === "/") path = "/index.html";
    // wasm-bindgen-rayon's worker re-imports its package as `import('../../..')`, i.e. the
    // package directory; a bundler would resolve that to the entry file, so we do too.
    if (path === "/prover-mt" || path === "/prover-mt/") path = "/prover-mt/index.js";
    console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${path}`);
    const file = Bun.file(path.startsWith("/prover-mt/") ? `${proverMt}/${path.slice("/prover-mt/".length)}` : `${dist}${path}`);
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    const ext = path.slice(path.lastIndexOf("."));
    // `?plain` drops the isolation headers, for A/B testing what they break.
    const isolation = url.searchParams.has("plain")
      ? {}
      : {
          // Cross-origin isolation: required for SharedArrayBuffer, hence for wasm threads.
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp",
          // Under require-corp, Chromium wants explicit CORP on scripts that nested workers load.
          "Cross-Origin-Resource-Policy": "same-origin",
        };
    return new Response(file, {
      headers: { "Content-Type": types[ext] ?? "application/octet-stream", "Cache-Control": "no-cache", ...isolation },
    });
  },
});
console.log(`serving ${dist} (and /prover-mt/ from ${proverMt}) on http://127.0.0.1:${port}`);
