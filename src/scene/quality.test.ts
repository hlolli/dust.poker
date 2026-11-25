import { expect, test } from "bun:test";
import { loungeRenderer, LoungeQuality } from "./quality.ts";

test("WebGL requests a fast GPU and retries allowing software before reporting it unavailable", () => {
  const requests: WebGLContextAttributes[] = [];
  const canvas = { getContext(type: string, options: WebGLContextAttributes) {
    expect(type).toBe("webgl2");
    requests.push(options);
    return null;
  } } as unknown as HTMLCanvasElement;
  expect(loungeRenderer(canvas, "")).toBeNull();
  expect(requests).toEqual([
    { alpha: false, powerPreference: "high-performance", antialias: true, failIfMajorPerformanceCaveat: true },
    { alpha: false, powerPreference: "high-performance", antialias: false },
  ]);
});

test("a slow lounge drops detail twice, while brief stalls and time away leave a smooth lounge alone", () => {
  const quality = new LoungeQuality(false);
  let now = 0;
  const run = (frames: number, ms: number) => {
    for (let i = 0; i < frames; i++) quality.frame(now += ms);
  };
  run(120, 17);
  run(1, 3000);
  run(120, 17);
  expect(quality.level).toBe("high");
  quality.resetTiming();
  now += 60_000;
  run(120, 17);
  expect(quality.level).toBe("high");
  run(65, 50);
  expect(quality.level).toBe("medium");
  run(80, 50);
  expect(quality.level).toBe("low");
});

test("low detail budgets physical 3D pixels independently of screen density", () => {
  const quality = new LoungeQuality(true);
  expect(quality.level).toBe("low");
  for (const [w, h] of [[1280, 720], [390, 844], [3840, 2160]] as const) {
    const ratio = quality.pixelRatio(w, h, 3);
    expect(Math.floor(w * ratio) * Math.floor(h * ratio)).toBeLessThanOrEqual(512 * 288);
  }
  expect(new LoungeQuality(false).pixelRatio(800, 600, 1.5)).toBe(1.5);
  for (let i = 0; i < 80; i++) quality.frame(i * 50);
  expect(quality.pixelRatio(384, 216, 2)).toBe(1);
  expect(quality.pixelRatio(768, 432, 2)).toBe(0.5);
});
