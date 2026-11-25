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
    await page.goto(new URL("?quality=low", site.url).href, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "+ your name", exact: true }).click();
    const preview = await (await page.waitForSelector(".creator")).waitForSelector("canvas");
    const changes = await preview.evaluate(async canvas => {
      const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      canvas.style.width = "301px";
      canvas.style.height = "221px";
      await frame();
      await frame();
      let writes = 0;
      const observer = new MutationObserver(records => { writes += records.length; });
      observer.observe(canvas, { attributes: true, attributeFilter: ["width"] });
      for (let i = 0; i < 5; i++) await frame();
      const stationary = writes;
      canvas.style.width = "337px";
      await frame();
      await frame();
      observer.disconnect();
      return { stationary, writes, width: canvas.width, height: canvas.height };
    });
    expect(changes).toEqual({ stationary: 0, writes: 1, width: 337, height: 221 });
    await page.getByRole("button", { name: "Never mind" }).click();
    expect(await preview.evaluate(canvas => canvas.getContext("webgl2")?.isContextLost())).toBe(true);
    await page.getByRole("button", { name: "Practice table" }).click();
    await page.getByRole("textbox", { name: "Name on the plate" }).fill("River");
    await page.getByRole("button", { name: "Take this name" }).click();
    const room = await page.waitForSelector("body > canvas");
    const buffer = await room.evaluate(element => {
      if (!(element instanceof HTMLCanvasElement)) throw new Error("Missing lounge canvas");
      return { webgl: !!element.getContext("webgl2"), pixels: element.width * element.height, width: element.clientWidth };
    });
    expect(buffer.webgl).toBe(true);
    expect(buffer.pixels).toBeLessThanOrEqual(512 * 288);
    expect(buffer.width).toBe(800);
    expect(await page.locator("main.menu").count()).toBe(0);
  } finally {
    await browser.close();
    site.stop(true);
  }
}, 90_000);
