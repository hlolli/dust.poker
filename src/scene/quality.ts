import { WebGLRenderer } from "three";

export const WEBGL_UNAVAILABLE = "This browser could not start WebGL 2 for the 3D lounge. Check that graphics acceleration is enabled, then reopen the table.";

export function loungeRenderer(canvas: HTMLCanvasElement, search: string, alpha = false) {
  const forced = new URLSearchParams(search).get("quality") === "low";
  const powerPreference = "high-performance";
  // Ask the browser for accelerated WebGL first. A software-only browser gets
  // another chance on the same canvas, without multisampling the back buffer.
  const accelerated = forced ? null : canvas.getContext("webgl2", { alpha, antialias: true, powerPreference, failIfMajorPerformanceCaveat: true });
  const context = accelerated ?? canvas.getContext("webgl2", { alpha, antialias: false, powerPreference });
  if (!context) return null;
  const renderer = new WebGLRenderer({ canvas, context, alpha, antialias: context.getContextAttributes()?.antialias });
  return { renderer, quality: new LoungeQuality(!accelerated || softwareRenderer(context)) };
}

/** Some browsers accept the accelerated request on a software backend. */
function softwareRenderer(gl: WebGL2RenderingContext): boolean {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
  return /SwiftShader|llvmpipe|softpipe|software rasterizer|Microsoft Basic Render Driver/i.test(renderer);
}

export class LoungeQuality {
  level: "high" | "medium" | "low";
  private lowPixels = 512 * 288;
  private previous: number | undefined;
  private elapsed = 0;
  private frames = 0;
  private slow = 0;

  constructor(low: boolean) {
    this.level = low ? "low" : "high";
  }

  pixelRatio(width: number, height: number, dpr: number) {
    if (this.level === "high") return Math.min(2, dpr);
    const pixels = this.level === "low" ? this.lowPixels : 1280 * 720;
    return Math.min(1, dpr, Math.sqrt(pixels / Math.max(1, width * height)));
  }

  resetTiming() {
    this.previous = undefined;
    this.frames = this.slow = this.elapsed = 0;
  }

  /** Step down for this visit only when most frames repeatedly miss the 30 fps budget. */
  frame(now: number): boolean {
    if (this.level === "low" && this.lowPixels === 384 * 216) return false;
    const last = this.previous;
    this.previous = now;
    if (last === undefined) return false;
    const ms = now - last;
    this.elapsed += ms;
    this.frames++;
    if (ms > 35) this.slow++;
    if (this.elapsed < 2000 || this.frames < 6) return false;
    const struggling = this.slow >= this.frames * 0.75;
    this.resetTiming();
    if (!struggling) return false;
    if (this.level === "low") this.lowPixels = 384 * 216;
    else this.level = this.level === "high" ? "medium" : "low";
    return true;
  }
}
