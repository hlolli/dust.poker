// Page side of the threaded benchmark: spawn the worker, print what it says.
const out = document.getElementById("out")!;
const log = (s: string) => {
  out.textContent += "\n" + s;
  console.log(s);
};

log(`crossOriginIsolated: ${crossOriginIsolated}, hardwareConcurrency: ${navigator.hardwareConcurrency}`);
if (!crossOriginIsolated) {
  log("BENCH FAIL: page is not cross-origin isolated; SharedArrayBuffer unavailable");
} else {
  const threads = Number(new URLSearchParams(location.search).get("threads") ?? navigator.hardwareConcurrency);
  // Built as its own entrypoint with a stable name; see build.ts.
  const worker = new Worker("/worker-mt.js", { type: "module" });
  worker.onmessage = (m: MessageEvent<{ log: string }>) => log(m.data.log);
  worker.onerror = (e) => log(`BENCH FAIL: worker error ${e.message}`);
  worker.postMessage({ threads });
}
