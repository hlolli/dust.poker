# Re-applies the diagnostic patch to the served wasm-bindgen-rayon helper after a rebuild:
# sub-workers bootstrap from blob: URLs (the embedded Browser pane refuses nested http
# workers; real browsers do not need this) and log their progress.
import glob, sys
paths = glob.glob(sys.argv[1] + "/snippets/wasm-bindgen-rayon-*/src/workerHelpers.js")
for p in paths:
    s = open(p).read()
    if "bootstrap" in s:
        print("already patched", p); continue
    s = s.replace("""      const worker = new Worker(new URL('./workerHelpers.js', import.meta.url), {
        type: 'module'
      });""", """      const helperUrl = new URL('./workerHelpers.js', import.meta.url).href;
      const bootstrap = URL.createObjectURL(new Blob([`import ${JSON.stringify(helperUrl)};`], { type: 'text/javascript' }));
      const worker = new Worker(bootstrap, { type: 'module' });
      worker.onerror = (e) => console.error('[startWorkers] worker error', e.message);""")
    s = s.replace("  const pkg = await import('../../..');\n  await pkg.default(init);\n  postMessage({ type: 'wasm_bindgen_worker_ready' });\n  pkg.wbg_rayon_start_worker(receiver);\n});",
                  "  try {\n  const pkg = await import('../../..');\n  await pkg.default(init);\n  postMessage({ type: 'wasm_bindgen_worker_ready' });\n  pkg.wbg_rayon_start_worker(receiver);\n  console.error('[sub-worker] rayon worker loop RETURNED');\n  } catch (e) { console.error('[sub-worker] FAILED', String(e && e.stack || e)); }\n});")
    open(p, "w").write(s)
    print("patched", p, "bootstrap" in s)
