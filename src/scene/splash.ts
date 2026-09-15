import * as THREE from "three";
import { brass, chrome, velvet } from "./materials.ts";
import { ROOM } from "./room.ts";
import { textPlane } from "./text.ts";

/**
 * The house sign on the far wall, 1950s marquee: a stepped velvet backplate edged in chrome,
 * a brass sunburst behind glowing script, bulbs all round. And the one door in the menu:
 * the Practice table.
 */
export function createSplash(): { group: THREE.Group; practiceDoor: THREE.Mesh } {
  const g = new THREE.Group();
  g.name = "splash";
  const wallZ = -ROOM.depth / 2 + 0.1;
  const y = 5.3;
  const chromeMat = chrome();
  const brassMat = brass();

  // Stepped backplate: three velvet slabs, each edged in chrome.
  for (const [wd, ht, dz] of [
    [6.4, 1.9, 0],
    [5.6, 1.6, 0.06],
    [4.8, 1.3, 0.12],
  ] as const) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(wd, ht, 0.06), velvet(0x3b0c18, 2));
    slab.position.set(0, y, wallZ + dz);
    g.add(slab);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(wd + 0.06, ht + 0.06, 0.02), chromeMat);
    edge.position.set(0, y, wallZ + dz - 0.03);
    g.add(edge);
  }

  // Sunburst: brass rays fanning out behind the lettering.
  const ray = new THREE.BoxGeometry(0.05, 1.9, 0.02);
  for (let i = 0; i < 17; i++) {
    const a = -Math.PI * 0.42 + (i / 16) * Math.PI * 0.84;
    const r = new THREE.Mesh(ray, brassMat);
    r.position.set(Math.sin(a) * 1.0, y - 0.45 + Math.cos(a) * 1.0, wallZ + 0.16);
    r.rotation.z = -a;
    g.add(r);
  }

  // A dark cartouche over the rays, so the script reads from the far end of the hall.
  const cartouche = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape().absellipse(0, 0, 2.3, 0.72, 0, Math.PI * 2, false, 0), 48), velvet(0x1a0810, 2));
  cartouche.position.set(0, y, wallZ + 0.18);
  g.add(cartouche);
  const cartoucheRim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 8, 72), chromeMat);
  cartoucheRim.scale.set(2.3, 0.72, 1);
  cartoucheRim.position.set(0, y, wallZ + 0.18);
  g.add(cartoucheRim);

  // The name, glowing warm gold like a neon script.
  const sign = textPlane("dust.poker", {
    width: 4.6,
    font: "italic bold 300px 'Brush Script MT', 'Snell Roundhand', cursive",
    color: "#fff0b8",
    glow: "#ff9a3c",
    canvas: [2048, 512],
  });
  sign.position.set(0, y, wallZ + 0.2);
  g.add(sign);

  // Bulbs around the outer plate.
  const bulb = new THREE.SphereGeometry(0.05, 10, 8);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffc46b, emissiveIntensity: 2.6 });
  for (let i = 0; i < 22; i++) {
    const b = new THREE.Mesh(bulb, bulbMat);
    b.position.set(-3.1 + (i / 21) * 6.2, y + 1.02, wallZ + 0.05);
    g.add(b);
    const b2 = new THREE.Mesh(bulb, bulbMat);
    b2.position.set(-3.1 + (i / 21) * 6.2, y - 1.02, wallZ + 0.05);
    g.add(b2);
  }
  const marquee = new THREE.PointLight(0xffb060, 30, 10, 2);
  marquee.position.set(0, y, wallZ + 1.2);
  g.add(marquee);

  // The door: a brass plaque floating between the player and the table.
  const practiceDoor = textPlane("PRACTICE TABLE", {
    width: 0.9,
    font: "bold 110px Georgia, serif",
    color: "#2a1a08",
    background: "#c9a24a",
  });
  practiceDoor.position.set(0, 0.95, 2.4);
  practiceDoor.rotation.x = -0.25;
  practiceDoor.name = "practice-door";
  g.add(practiceDoor);

  const plaqueFrame = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.3, 0.03), brassMat);
  plaqueFrame.position.set(0, 0.95, 2.38);
  plaqueFrame.rotation.x = -0.25;
  g.add(plaqueFrame);

  return { group: g, practiceDoor };
}
