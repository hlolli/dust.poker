import * as THREE from "three";
import type { Avatar } from "./avatars.ts";

/**
 * A player's look: a base character, and what the creator lets them change on it. The
 * Rocketbox characters keep their clothing in one body texture, so an outfit colour is a
 * repaint of that texture (as the dealer's suit is), skin a tint of it and of the head, height
 * a scale of the whole body. Hair is painted into the head texture on these characters, and the
 * separate alpha mesh is a hairnet or lashes on some of them, so hair colour waits for a
 * per-character repaint; the field stays so stored profiles keep reading.
 */
export type Look = {
  model: number;
  /** 0 light to 1 dark. */
  skin: number;
  /** Hair colour, hex. Kept, not applied yet (see above). */
  hair: string;
  /** Outfit colour, hex. */
  outfit: string;
  /** 0.92 short to 1.08 tall, 1 as the model comes. */
  height: number;
};

export const DEFAULT_LOOK: Look = { model: 0, skin: 0.3, hair: "#3a2416", outfit: "#2a2a34", height: 1 };
export const HAIR_COLOURS = ["#f2e2b0", "#c98a3a", "#8a4a1c", "#3a2416", "#151010", "#a83a2a", "#c8c8d0", "#6a2a8a"];
export const OUTFIT_COLOURS = ["#2a2a34", "#5a1420", "#1f4a3a", "#2a3a6e", "#8a6a1c", "#e8e0cc", "#6a2a8a", "#b8862a"];

/** Repaints and reshapes a loaded character to a look. Safe to call again with another look. */
export function applyLook(avatar: Avatar, look: Look) {
  const skinScale = 1.12 - look.skin * 0.7; // light skins a touch brighter, dark ones down to 0.42
  const outfit = new THREE.Color(look.outfit);
  avatar.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    if (material.name.endsWith("_body")) repaintBody(mesh, material, skinScale, outfit);
    else if (material.name.endsWith("_head")) material.color.setScalar(skinScale);
  });
  avatar.root.scale.setScalar(look.height);
}

function repaintBody(mesh: THREE.Mesh, material: THREE.MeshStandardMaterial, skinScale: number, outfit: THREE.Color) {
  // The texture as it came, kept so every repaint starts from the original.
  const original: THREE.Texture = (material.userData.original ??= material.map);
  if (!original) return;
  const image = original.image as ImageBitmap | HTMLImageElement;
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height);
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.floor(i / 4 / c.width) / c.height;
    const [r, g, b] = [d[i]! / 255, d[i + 1]! / 255, d[i + 2]! / 255];
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    if (lum < 0.06) continue; // the atlas's black background
    const max = Math.max(r, g, b);
    const sat = max - Math.min(r, g, b);
    const skin = r > g && g > b && sat > 0.1 && lum > 0.22; // warm, red over green over blue: skin
    if (skin) {
      d[i] = Math.min(255, Math.round(r * 255 * skinScale));
      d[i + 1] = Math.min(255, Math.round(g * 255 * skinScale * (0.96 + 0.04 * skinScale)));
      d[i + 2] = Math.min(255, Math.round(b * 255 * skinScale * (0.9 + 0.1 * skinScale)));
    } else if (y < 0.8) {
      // Cloth: the outfit colour carrying the cloth's own shading (the shoes, at the bottom of the atlas, stay).
      const k = Math.min(1.8, lum * 3 + 0.25);
      d[i] = Math.min(255, Math.round(outfit.r * 255 * k));
      d[i + 1] = Math.min(255, Math.round(outfit.g * 255 * k));
      d[i + 2] = Math.min(255, Math.round(outfit.b * 255 * k));
    }
  }
  ctx.putImageData(px, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.flipY = original.flipY;
  map.colorSpace = original.colorSpace;
  map.wrapS = original.wrapS;
  map.wrapT = original.wrapT;
  if (material.map !== original) material.map?.dispose();
  material.map = map;
  material.needsUpdate = true;
  void mesh;
}
