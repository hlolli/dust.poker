import { expect, test } from "bun:test";
import { chromium } from "playwright-core";

function serveSite() {
  const dist = new URL("../../dist/", import.meta.url);
  return Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname.slice(1) || "index.html";
      if (!/^(?:club\/)?[\w-]+[\w.-]*$/.test(path)) return new Response(null, { status: 404 });
      return new Response(Bun.file(new URL(path, dist)));
    },
  });
}

test.skipIf(!process.env.POKER_BROWSER_TEST)("the field guides work on mobile without a wallet or JavaScript", async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const site = serveSite();
  try {
    const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 360, height: 780 } });
    await page.goto(site.url.href);
    await page.getByRole("link", { name: "How it works" }).click();
    await page.getByRole("link", { name: "Inspect the protocol" }).click();
    await page.getByRole("heading", { name: "What does a shuffle prove?" }).waitFor();
    expect(await page.locator("#proofs").evaluate(el => Math.abs(el.getBoundingClientRect().top) < 2)).toBe(true);
    await page.getByRole("link", { name: "Wallet setup" }).click();
    await page.getByRole("heading", { name: "Bring friends to a Live table" }).waitFor();
    expect(await page.locator(".menu").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole("link", { name: "Choose a table", exact: true }).last().click();
    expect(new URL(page.url()).hash).toBe("#tables");
  } finally {
    await browser.close();
    site.stop(true);
  }
}, 30_000);

test.skipIf(!process.env.POKER_BROWSER_TEST)("a Live invite keeps its network and only opens a table after both indexer checks pass", async () => {
  const browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-swiftshader"] });
  const site = serveSite();
  try {
    const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    await context.addInitScript(() => {
      window.midnight = { lace: {
        name: "Test Lace", rdns: "test.lace", icon: "", apiVersion: "4.0.0",
        async connect(networkId) {
          if (networkId !== "preview") throw new Error("Network ID mismatch");
          return {
            getConfiguration: async () => ({ networkId, substrateNodeUri: "https://rpc.preview.midnight.network", indexerUri: "https://blockfrost.lw.iog.io/midnight-preview/", indexerWsUri: "wss://blockfrost.lw.iog.io/midnight-preview/ws" }),
            getUnshieldedAddress: async () => ({ unshieldedAddress: "mn_addr_preview1pvc9275lcn5suv6c0k3v0mq3xedcpfw2au2rjh5r4rxly9euvxrq6nhvej" }),
            getDustBalance: async () => ({ balance: 0n, cap: 0n }),
            getProvingProvider: async () => { throw new Error("unexpected proof"); },
            balanceUnsealedTransaction: async () => { throw new Error("unexpected balance"); },
            submitTransaction: async () => { throw new Error("unexpected submission"); },
          };
        },
      } };
    });
    const page = await context.newPage();
    const indexer = "indexer.preview.midnight.network/api/v4/graphql";
    let status = 403;
    let allowSocket = false;
    await page.route(`https://${indexer}`, route => route.fulfill({ status, json: { data: { block: { protocolVersion: 2_001_100 } } } }));
    await page.routeWebSocket(`wss://${indexer}/ws`, ws => ws.onMessage(() => {
      if (allowSocket) ws.send('{"type":"connection_ack"}');
      else ws.close({ code: 4403, reason: "denied" });
    }));
    const invite = `${site.url.href}?network=preview&table=${"ab".repeat(32)}`;
    await page.goto(invite + "&fx=off", { waitUntil: "domcontentloaded" });
    const connect = page.getByRole("button", { name: "Connect Lace" });
    const join = page.getByRole("button", { name: "Take a seat" });
    await connect.click();
    await page.getByRole("status").filter({ hasText: "HTTP 403" }).waitFor();
    expect(await join.isVisible()).toBe(false);
    status = 200;
    await connect.click();
    await page.getByRole("status").filter({ hasText: "WebSocket" }).waitFor();
    expect(await join.isVisible()).toBe(false);
    allowSocket = true;
    await connect.click();
    await join.waitFor();
    await page.getByText("Lace reported zero tDUST at connection.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Copy table link" }).click();
    await page.getByRole("status").filter({ hasText: "link copied" }).waitFor();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(invite);
    await page.locator("label").filter({ hasText: "preprod" }).click();
    expect(await page.getByLabel("Table address").inputValue()).toBe("");
    await connect.click();
    await page.getByRole("status").filter({ hasText: "Switch Test Lace to preprod" }).waitFor();
    expect(await join.isVisible()).toBe(false);
  } finally {
    await browser.close();
    site.stop(true);
  }
}, 60_000);

test.skipIf(!process.env.POKER_BROWSER_TEST)("the character preview resizes only when its layout changes at fractional pixel density", async () => {
  const browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-swiftshader"] });
  const site = serveSite();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1.25 });
    await page.goto(site.url.href, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "+ your name", exact: true }).click();
    const changes = await page.locator(".creator canvas").evaluate(async (canvas: HTMLCanvasElement) => {
      const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      canvas.style.width = "321px";
      canvas.style.height = "241px";
      await frame();
      await frame();
      let writes = 0;
      const observer = new MutationObserver(records => { writes += records.length; });
      observer.observe(canvas, { attributes: true, attributeFilter: ["width"] });
      for (let i = 0; i < 5; i++) await frame();
      const stationary = writes;
      canvas.style.width = "357px";
      await frame();
      await frame();
      observer.disconnect();
      return { stationary, writes, width: canvas.width, height: canvas.height };
    });
    expect(changes).toEqual({ stationary: 0, writes: 1, width: 446, height: 301 });
    await page.getByRole("button", { name: "Never mind" }).click();
    await page.getByRole("button", { name: "Practice table" }).click();
    await page.getByRole("textbox", { name: "Name on the plate" }).fill("River");
    await page.getByRole("button", { name: "Take this name" }).click();
    await page.locator("body > canvas").waitFor();
    expect(await page.locator("main.menu").count()).toBe(0);
  } finally {
    await browser.close();
    site.stop(true);
  }
}, 60_000);
