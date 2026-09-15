import * as THREE from "three";
import { type Card, rankOf, suitOf } from "../poker/cards.ts";

export const CARD_W = 0.0635;
export const CARD_H = 0.0889;

const SUIT_GLYPH = { c: "♣", d: "♦", h: "♥", s: "♠" } as const;

// Shared by every card on the table: one geometry, one material per face (53 at most).
const geometry = new THREE.PlaneGeometry(CARD_W, CARD_H);
const materials = new Map<string, THREE.MeshLambertMaterial>();

function texture(face: Card | "back"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  // Power-of-two canvas so mipmaps work; the face is drawn at the card's aspect and
  // stretched onto it, which the plane's own aspect undoes.
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.scale(1, 512 / 358);
  ctx.fillStyle = "#f6f1e6";
  ctx.beginPath();
  ctx.roundRect(0, 0, 256, 358, 24);
  ctx.fill();
  if (face === "back") {
    ctx.fillStyle = "#7a1020";
    ctx.beginPath();
    ctx.roundRect(16, 16, 256 - 32, 358 - 32, 16);
    ctx.fill();
    ctx.strokeStyle = "#c9a24a";
    ctx.lineWidth = 3;
    for (let y = 32; y < 358 - 16; y += 28) for (let x = 32; x < 256 - 16; x += 28) ctx.strokeRect(x, y, 14, 14);
  } else {
    const red = suitOf(face) === "d" || suitOf(face) === "h";
    ctx.fillStyle = red ? "#b3141c" : "#1a1a1a";
    ctx.font = "bold 120px Georgia, serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(rankOf(face) === "T" ? "10" : rankOf(face), 18, 10);
    ctx.font = "150px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(SUIT_GLYPH[suitOf(face)], 128, 358 / 2 + 50);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function material(face: Card | "back"): THREE.MeshLambertMaterial {
  let m = materials.get(face);
  if (!m) materials.set(face, (m = new THREE.MeshLambertMaterial({ map: texture(face) })));
  return m;
}

/** A card lying flat, face up along +y. Call `show()` to change what it shows. */
export class CardMesh {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  constructor() {
    this.mesh = new THREE.Mesh(geometry, material("back"));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
  }
  show(face: Card | "back" | null) {
    this.mesh.visible = face !== null;
    if (face) this.mesh.material = material(face);
  }
}
