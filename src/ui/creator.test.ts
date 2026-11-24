import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { serveSite } from "../../scripts/browser-test-site.ts";

test.skipIf(!process.env.POKER_BROWSER_TEST)("the creator resizes its preview on layout changes and opens a first Practice game", async () => {
  const browser = await chromium.launch({ channel: "chrome", args: ["--enable-unsafe-swiftshader"] });
  const site = serveSite();
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1.25 });
    page.setDefaultTimeout(30_000);
    page.on("pageerror", error => console.error("Practice page:", error.message));
    await page.goto(new URL("?fx=off", site.url).href, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "+ your name", exact: true }).click();
    const preview = await (await page.waitForSelector(".creator")).waitForSelector("canvas");
    const changes = await preview.evaluate(async canvas => {
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
    expect(await preview.evaluate(canvas => canvas.getContext("webgl2")?.isContextLost())).toBe(true);
    await page.getByRole("button", { name: "Practice table" }).click();
    await page.getByRole("textbox", { name: "Name on the plate" }).fill("River");
    await page.getByRole("button", { name: "Take this name" }).click();
    await page.locator("body > canvas").waitFor();
    expect(await page.locator("main.menu").count()).toBe(0);
  } finally {
    await browser.close();
    site.stop(true);
  }
}, 90_000);
