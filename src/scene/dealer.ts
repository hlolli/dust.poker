import * as THREE from "three";
import type { Avatar } from "./avatars.ts";
import { CARD_H, CARD_W, cardBack } from "./cards.ts";
import { DEALER_POSE } from "./table.ts";

/**
 * Dresses a Rocketbox business character as a 1960s Las Vegas dealer: the suit repainted
 * burgundy, the necktie blacked out, and a black bow tie at the collar. The suit lives in one
 * body texture with the clothing baked in, so this repaints pixels: anything dark and grey is
 * suit (the shoes, at the bottom of the atlas, are left alone), and the tie sits alone in its
 * own patch of the atlas.
 */
export function dressAsDealer(avatar: Avatar) {
  let bodyMesh: THREE.Mesh | undefined;
  avatar.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material) && m.material.name.endsWith("_body")) bodyMesh = m;
  });
  const body = bodyMesh?.material as THREE.MeshStandardMaterial | undefined;
  const source = body?.map;
  if (bodyMesh && body && source) {
    const image = source.image as ImageBitmap | HTMLImageElement;
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height);
    const d = px.data;
    for (let i = 0; i < d.length; i += 4) {
      const x = (i / 4) % c.width / c.width;
      const y = Math.floor(i / 4 / c.width) / c.height;
      const [r, g, b] = [d[i]! / 255, d[i + 1]! / 255, d[i + 2]! / 255];
      const lum = 0.3 * r + 0.59 * g + 0.11 * b;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      if (x > 0.27 && x < 0.37 && y > 0.11 && y < 0.33 && lum > 0.06) {
        // The necktie: black, so the bow tie reads as the only tie.
        d[i] = d[i + 1] = d[i + 2] = Math.round(lum * 40);
      } else if (lum > 0.06 && lum < 0.4 && sat < 0.22 && y < 0.8) {
        // The suit: burgundy, keeping the cloth's shading.
        const k = Math.min(1, lum * 2.4 + 0.08);
        d[i] = Math.round(120 * k + 10);
        d[i + 1] = Math.round(16 * k);
        d[i + 2] = Math.round(28 * k);
      }
    }
    ctx.putImageData(px, 0, 0);
    const map = new THREE.CanvasTexture(c);
    map.flipY = source.flipY;
    map.colorSpace = source.colorSpace;
    map.wrapS = source.wrapS;
    map.wrapT = source.wrapT;
    const dressed = body.clone();
    dressed.map = map;
    bodyMesh.material = dressed;
  }

  // The bow tie: two wings and a knot, black, at the collar, riding on the neck bone.
  const neck = avatar.bones.get("Bip01 Neck");
  if (neck) {
    avatar.root.updateMatrixWorld(true);
    const black = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.6 });
    const tie = new THREE.Group();
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.028, 0.012), black);
      wing.position.x = s * 0.028;
      wing.rotation.z = s * 0.12;
      tie.add(wing);
    }
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.018, 0.016), black);
    tie.add(knot);
    const at = new THREE.Vector3();
    neck.getWorldPosition(at);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(avatar.root.quaternion);
    tie.position.copy(at).addScaledVector(forward, 0.075).add(new THREE.Vector3(0, -0.005, 0));
    tie.quaternion.copy(avatar.root.quaternion);
    avatar.root.parent?.add(tie); // world placement first...
    neck.attach(tie); // ...then it rides with the neck
  }
}

/** Where the deck is: cards are thrown from here. A guess until the dealer has loaded, then the deck's own place. */
export const DEAL_FROM = DEALER_POSE.position.clone().add(DEALER_POSE.position.clone().negate().setY(0).normalize().multiplyScalar(0.38)).setY(0.98);

/** The deck in the dealer's left palm: fifty-two cards, back up, riding on the hand bone. */
export function deckInHand(avatar: Avatar): THREE.Mesh {
  const paper = new THREE.MeshLambertMaterial({ color: 0xf6f1e6 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, 0.016, CARD_H), [paper, paper, cardBack(), cardBack(), paper, paper]);
  avatar.root.updateMatrixWorld(true);
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  avatar.hand("L").getWorldPosition(left);
  avatar.hand("R").getWorldPosition(right);
  // In the left palm, a little toward the right hand and up out of the fingers.
  deck.position.copy(left).lerp(right, 0.22).add(new THREE.Vector3(0, 0.035, 0));
  deck.rotation.y = DEALER_POSE.yaw + 0.25; // held a little askew, as a dealer does
  deck.rotation.x = 0.15;
  DEAL_FROM.copy(deck.position);
  avatar.root.parent?.add(deck);
  avatar.hand("L").attach(deck);
  return deck;
}
