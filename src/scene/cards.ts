import * as THREE from "three";
import { type Card, rankOf, suitOf } from "../poker/cards.ts";

export const CARD_W = 0.0635;
export const CARD_H = 0.0889;

const SUIT_GLYPH = { c: "♣", d: "♦", h: "♥", s: "♠" } as const;
const textures = new Map<string, THREE.CanvasTexture>();

function texture(face: Card | "back"): THREE.CanvasTexture {
  const hit = textures.get(face);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 358;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f6f1e6";
  ctx.beginPath();
  ctx.roundRect(0, 0, c.width, c.height, 24);
  ctx.fill();
  if (face === "back") {
    ctx.fillStyle = "#7a1020";
    ctx.beginPath();
    ctx.roundRect(16, 16, c.width - 32, c.height - 32, 16);
    ctx.fill();
    ctx.strokeStyle = "#c9a24a";
    ctx.lineWidth = 3;
    for (let y = 32; y < c.height - 16; y += 28)
      for (let x = 32; x < c.width - 16; x += 28) ctx.strokeRect(x, y, 14, 14);
  } else {
    const red = suitOf(face) === "d" || suitOf(face) === "h";
    ctx.fillStyle = red ? "#b3141c" : "#1a1a1a";
    ctx.font = "bold 120px Georgia, serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const rank = rankOf(face) === "T" ? "10" : rankOf(face);
    ctx.fillText(rank, 18, 10);
    ctx.font = "150px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(SUIT_GLYPH[suitOf(face)], c.width / 2, c.height / 2 + 50);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  textures.set(face, t);
  return t;
}

/** A card lying flat, face up along +y. Call `show()` to change what it shows. */
export class CardMesh {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(CARD_W, CARD_H),
      new THREE.MeshStandardMaterial({ map: texture("back"), roughness: 0.6 }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
  }
  show(face: Card | "back" | null) {
    this.mesh.visible = face !== null;
    if (face) this.mesh.material.map = texture(face);
  }
}
