import * as THREE from "three";

export type LabelOptions = {
  /** World width of the plane in metres; height follows the canvas aspect. */
  width: number;
  font?: string;
  color?: string;
  /** Glow colour; omit for no glow. */
  glow?: string;
  background?: string;
  /** Canvas size, powers of two so mipmaps work; keep the aspect close to the text you expect. */
  canvas?: [number, number];
};

// ponytail: canvas text, not SDF text. Crisp enough at these sizes, no font download,
// no dependency. Swap for troika-three-text if labels ever need to be tiny.
export class Label {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly canvas = document.createElement("canvas");
  private readonly texture: THREE.CanvasTexture;
  private text = "";

  constructor(text: string, private readonly o: LabelOptions) {
    const [w, h] = o.canvas ?? [1024, 256];
    this.canvas.width = w;
    this.canvas.height = h;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(o.width, (o.width * h) / w),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }),
    );
    this.set(text);
  }

  /** Frees the GPU texture, geometry and material. The mesh is unusable afterwards. */
  dispose() {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  set(text: string, override?: Partial<Pick<LabelOptions, "color" | "background">>) {
    const o = { ...this.o, ...override };
    if (text === this.text && !override) return;
    this.text = text;
    const { canvas } = this;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (o.background) {
      ctx.fillStyle = o.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const font = o.font ?? "italic bold 150px 'Brush Script MT', 'Snell Roundhand', cursive";
    const { lines, size } = fit(ctx, text, font, canvas.width - PAD * 2, canvas.height - PAD);
    ctx.font = font.replace(/\d+px/, `${size}px`);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = o.color ?? "#fff";
    const lineHeight = size * LINE;
    const draw = () => lines.forEach((l, i) => drawLine(ctx, l, canvas.width / 2, canvas.height / 2 + (i - (lines.length - 1) / 2) * lineHeight));
    ctx.shadowBlur = 0;
    if (o.glow) {
      ctx.shadowColor = o.glow;
      ctx.shadowBlur = 40;
      draw();
      ctx.shadowBlur = 16;
    }
    draw();
    this.texture.needsUpdate = true;
  }
}

const PAD = 24;
const LINE = 1.15;

/** Width of a line when every digit takes the widest digit's advance (canvas has no tabular figures). */
function lineWidth(ctx: CanvasRenderingContext2D, s: string): number {
  const digit = ctx.measureText("0").width;
  let w = 0;
  for (const ch of s) w += /\d/.test(ch) ? digit : ctx.measureText(ch).width;
  return w;
}

/** Draws a line centred on `cx`, digits on a fixed advance so a changing number does not shift the text around it. */
function drawLine(ctx: CanvasRenderingContext2D, s: string, cx: number, y: number) {
  const digit = ctx.measureText("0").width;
  let x = cx - lineWidth(ctx, s) / 2;
  ctx.textAlign = "left";
  for (const ch of s) {
    const w = /\d/.test(ch) ? digit : ctx.measureText(ch).width;
    ctx.fillText(ch, x + (w - ctx.measureText(ch).width) / 2, y);
    x += w;
  }
  ctx.textAlign = "center";
}

/**
 * Makes text fit a box: at the font's own size on one line when it can; else shrunk to no less
 * than 55 percent of it; else wrapped on words, and shrunk further only if the lines would
 * overflow the height. Nothing drawn here ever leaves its label.
 */
function fit(ctx: CanvasRenderingContext2D, text: string, font: string, width: number, height: number): { lines: string[]; size: number } {
  const base = Number(/(\d+)px/.exec(font)?.[1] ?? 100);
  const measure = (s: string, size: number) => {
    ctx.font = font.replace(/\d+px/, `${size}px`);
    return lineWidth(ctx, s);
  };
  let size = base;
  while (size > base * 0.55 && measure(text, size) > width) size -= Math.max(1, base * 0.05);
  if (measure(text, size) <= width) return { lines: [text], size };
  // Wrap on words at this size, then shrink until the lines fit the height and the widest line the width.
  for (;;) {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, size) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
    const widest = Math.max(...lines.map((l) => measure(l, size)));
    if ((lines.length * size * LINE <= height && widest <= width) || size <= 8) return { lines, size };
    size = Math.floor(size * 0.9);
  }
}

export function textPlane(text: string, o: LabelOptions): THREE.Mesh {
  return new Label(text, o).mesh;
}
