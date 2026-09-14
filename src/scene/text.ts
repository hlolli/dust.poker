import * as THREE from "three";

export type TextPlaneOptions = {
  /** World width of the plane in metres; height follows the canvas aspect. */
  width: number;
  font?: string;
  color?: string;
  /** Glow colour; omit for no glow. */
  glow?: string;
  background?: string;
};

// ponytail: canvas text, not SDF text. Crisp enough at these sizes, no font download,
// no dependency. Swap for troika-three-text if labels ever need to be tiny.
export function textPlane(text: string, o: TextPlaneOptions): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  if (o.background) {
    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.font = o.font ?? "italic bold 150px 'Brush Script MT', 'Snell Roundhand', cursive";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = o.color ?? "#fff";
  if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = 40;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    ctx.shadowBlur = 16;
  }
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(o.width, (o.width * canvas.height) / canvas.width),
    new THREE.MeshBasicMaterial({ map: texture, transparent: !o.background }),
  );
  return mesh;
}
