// The dev server: the page with hot reload, as `bun src/index.html` gives it, plus the proving
// keys under /deal, which the Live table's prover fetches (src/live/chain.ts) and which the site
// build copies next to the page (build-site.ts). Only what `compact:build --zk` has written.
import index from "../src/index.html";
import { readdirSync } from "node:fs";

const root = `${import.meta.dir}/..`;
const port = Number(process.env.PORT ?? 3000);
const club = `${root}/src/assets/site/club`;

Bun.serve({
  port,
  development: { hmr: true, console: true },
  routes: {
    "/": index,
    ...Object.fromEntries(["robots.txt", "sitemap.xml"].map(name => [`/${name}`, () => new Response(Bun.file(`${root}/src/assets/site/${name}`))])),
    ...Object.fromEntries(readdirSync(club).map(name => [`/club/${name}`, () => new Response(Bun.file(`${club}/${name}`))])),
    ...Object.fromEntries(["deal", "queue", "public-seat"].map(name => [`/${name}/*`, async (req: Request) => {
      const path = new URL(req.url).pathname.slice(name.length + 2);
      if (!/^(keys|zkir)\/[\w-]+\.(?:verifier|prover|bzkir|zkir)$/.test(path)) return new Response("no", { status: 404 });
      const file = Bun.file(`${root}/contracts/build/${name}/${path}`);
      return (await file.exists()) ? new Response(file) : new Response("not built: bun run compact:build --zk", { status: 404 });
    }])),
  },
});
console.log(`dust.poker on http://localhost:${port}`);
