// The dev server: the page with hot reload, as `bun src/index.html` gives it, plus the proving
// keys under /deal, which the Live table's prover fetches (src/live/chain.ts) and which the site
// build copies next to the page (build-site.ts). Only what `compact:build --zk` has written.
import index from "../src/index.html";

const root = `${import.meta.dir}/..`;
const port = Number(process.env.PORT ?? 3000);

Bun.serve({
  port,
  development: { hmr: true, console: true },
  routes: {
    "/": index,
    "/deal/*": async (req) => {
      const path = decodeURIComponent(new URL(req.url).pathname.slice("/deal/".length));
      if (path.includes("..")) return new Response("no", { status: 400 });
      const file = Bun.file(`${root}/contracts/build/deal/${path}`);
      return (await file.exists()) ? new Response(file) : new Response("not built: bun run compact:build --zk", { status: 404 });
    },
  },
});
console.log(`dust.poker on http://localhost:${port}`);
