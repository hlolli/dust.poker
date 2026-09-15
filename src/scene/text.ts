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
    ctx.font = o.font ?? "italic bold 150px 'Brush Script MT', 'Snell Roundhand', cursive";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = o.color ?? "#fff";
    ctx.shadowBlur = 0;
    if (o.glow) {
      ctx.shadowColor = o.glow;
      ctx.shadowBlur = 40;
      ctx.fillText(text, canvas.width / 2, canvas.height / 2);
      ctx.shadowBlur = 16;
    }
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    this.texture.needsUpdate = true;
  }
}

export function textPlane(text: string, o: LabelOptions): THREE.Mesh {
  return new Label(text, o).mesh;
}
