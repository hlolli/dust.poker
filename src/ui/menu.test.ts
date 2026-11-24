import { expect, test } from "bun:test";
import { $ } from "bun";
import { chromium } from "playwright-core";
import { serveSite } from "../../scripts/browser-test-site.ts";
import { tableLink } from "./table-invite.ts";

test("a copied invite carries only the table and its network", () => {
  expect(tableLink("preview", "AB".repeat(32), "https://user:pass@example.test/poker?wallet=private&keys=local#tables"))
    .toBe(`https://example.test/poker?network=preview&table=${"ab".repeat(32)}`);
});

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
  const fixture = new URL("../../scripts/invite-lobby-fixture.ts", import.meta.url);
  const { address, state, opened, ledgerParameters } = await $`bun ${fixture.pathname}`.json() as Record<"address" | "state" | "opened" | "ledgerParameters", string>;
  const browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-swiftshader"] });
  const site = serveSite(Bun.file(new URL("../live/any.verifier", import.meta.url)));
  try {
    const context = await browser.newContext({ viewport: { width: 520, height: 540 }, permissions: ["clipboard-read", "clipboard-write"] });
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
    page.setDefaultTimeout(30_000);
    page.on("pageerror", error => console.error("Invite page:", error.message));
    const indexer = "indexer.preview.midnight.network/api/v4/graphql";
    let status = 200;
    let allowSocket = false;
    await page.route(`https://${indexer}`, route => {
      const isTable = route.request().postDataJSON().variables?.address === address;
      return route.fulfill({ status, json: { data: { block: { protocolVersion: 2_001_100, height: 3, hash: "01".repeat(32), timestamp: Date.now(), ledgerParameters }, contractAction: isTable ? { state } : null, contract: isTable ? { updates: [{ state: opened }], deploys: [] } : null } } });
    });
    await page.routeWebSocket(`wss://${indexer}/ws`, ws => ws.onMessage(message => {
      if (JSON.parse(message.toString()).type !== "connection_init") return;
      if (allowSocket) ws.send('{"type":"connection_ack"}');
      else ws.close({ code: 4403, reason: "denied" });
    }));
    const invite = `${site.url.href}?network=preview&table=${address}`;
    await page.goto(invite + "&fx=off", { waitUntil: "domcontentloaded" });
    const connect = page.getByRole("button", { name: "Connect Lace" });
    const join = page.getByRole("button", { name: "Join table" });
    await page.getByRole("heading", { name: "Table invitation" }).waitFor();
    await page.getByText("1 of 6 seated").waitFor();
    expect(await join.isDisabled()).toBe(true);
    expect(await page.locator("body > canvas").count()).toBe(0);
    status = 403;
    await connect.click();
    await page.getByRole("status").filter({ hasText: "HTTP 403" }).waitFor();
    expect(await join.isDisabled()).toBe(true);
    status = 200;
    await connect.click();
    await page.getByRole("status").filter({ hasText: "WebSocket" }).waitFor();
    expect(await join.isDisabled()).toBe(true);
    allowSocket = true;
    await connect.click();
    await page.getByText("1 of 6 seated").waitFor();
    expect(await page.getByRole("list", { name: "Table seats" }).getByText(/^Player [0-9a-f]{8}$/).count()).toBe(1);
    expect(await page.locator("body > canvas").count()).toBe(0);
    await page.getByText("Lace reported zero tDUST at connection.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Copy invite link" }).click();
    await page.getByRole("status").filter({ hasText: "link copied" }).waitFor();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(invite);
    await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("denied"); } } }); });
    await page.getByRole("button", { name: "Copy invite link" }).click();
    expect(await page.getByRole("textbox", { name: "Table invite link" }).inputValue()).toBe(invite);
    await page.getByRole("link", { name: "All tables" }).click();
    await page.locator("label").filter({ hasText: "preprod" }).click();
    expect(await page.getByLabel("Table address").inputValue()).toBe("");
    await connect.click();
    await page.getByRole("status").filter({ hasText: "Switch Test Lace to preprod" }).waitFor();
    expect(await join.isVisible()).toBe(false);
    await page.evaluate(() => localStorage.setItem("dust.poker/profiles", JSON.stringify({ active: "a", list: [{ id: "a", name: "Alice", secret: "7", model: 0 }] })));
    await page.goto(`${site.url.href}?network=preview&fx=off`);
    await connect.click();
    const find = page.getByRole("button", { name: "Find a public seat" });
    await find.waitFor();
    expect(await page.getByLabel("Table address").isVisible()).toBe(false);
    await find.click();
    await page.getByRole("button", { name: "Open the public queue" }).waitFor();
    await page.locator("#live-table summary").filter({ hasText: "Play with friends" }).click();
    expect(await page.getByLabel("Table address").isVisible()).toBe(true);
    await page.getByLabel("Table address").fill(address);
    await page.getByRole("button", { name: "View table" }).click();
    await page.getByText("Alice (you)").waitFor();
    expect(await page.locator("body > canvas").count()).toBe(0);
    await join.click();
    await page.getByRole("button", { name: "Back to lobby" }).waitFor();
    await page.getByRole("button", { name: "Copy invite link" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(invite);
    await page.getByRole("button", { name: "Back to lobby" }).click();
    await page.getByText("Alice (you)").waitFor();
    expect(await page.locator("body > canvas").count()).toBe(0);
  } finally {
    await browser.close();
    site.stop(true);
  }
}, 90_000);
