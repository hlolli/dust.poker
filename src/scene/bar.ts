import * as THREE from "three";
import { brass, chrome, darkWood, leather, marbleBlack } from "./materials.ts";

// The cocktail bar along the hall's right-hand wall: a long counter with a marble top and
// brass foot rail, a mirrored back bar with lit shelves of bottles, four stools. The
// bartender is an avatar placed by main.ts at `BARTENDER_POSE`.

export const BAR = { x: 6.2, z: 0, length: 6 };
/** Where the bartender stands: behind the counter, facing the room (-x). */
export const BARTENDER_POSE = { position: new THREE.Vector3(BAR.x + 0.55, 0, BAR.z), rotationY: -Math.PI / 2 };

const BOTTLE_COLORS = [0xffb347, 0x7cd992, 0x4aa8ff, 0xff5c7a, 0xf2e6c8, 0xc77dff, 0xffe066];

export function createBar(): THREE.Group {
  const g = new THREE.Group();
  g.name = "bar";
  const wood = darkWood(2);
  const brassMat = brass();
  const { x, z, length } = BAR;

  // Counter: wood front, black marble top, brass edge and foot rail.
  const counter = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, length), wood);
  counter.position.set(x, 0.55, z);
  g.add(counter);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.05, length + 0.15), marbleBlack(2));
  top.position.set(x, 1.125, z);
  g.add(top);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, length + 0.15), brassMat);
  edge.position.set(x - 0.37, 1.135, z);
  g.add(edge);
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, length, 12), brassMat);
  rail.rotation.x = Math.PI / 2;
  rail.position.set(x - 0.45, 0.25, z);
  g.add(rail);

  // Back bar against the wall: shelves in front of a mirror, bottles glowing on them.
  const wallX = 6.95;
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(length, 2.2), chrome());
  mirror.rotation.y = -Math.PI / 2;
  mirror.position.set(wallX - 0.02, 2.1, z);
  g.add(mirror);
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.0, length), wood);
  cabinet.position.set(wallX - 0.2, 0.5, z);
  g.add(cabinet);
  const shelfGeometry = new THREE.BoxGeometry(0.3, 0.03, length);
  const bottle = new THREE.CylinderGeometry(0.035, 0.04, 0.3, 10);
  const neck = new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8);
  const glow = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 1.5 });
  const bottleMats = BOTTLE_COLORS.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, roughness: 0.15, transparent: true, opacity: 0.85 }),
  );
  for (const y of [1.45, 2.05, 2.65]) {
    const shelf = new THREE.Mesh(shelfGeometry, wood);
    shelf.position.set(wallX - 0.2, y, z);
    g.add(shelf);
    // A light strip under each shelf lights the row below.
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.01, length - 0.2), glow);
    strip.position.set(wallX - 0.34, y - 0.02, z);
    g.add(strip);
    for (let i = 0; i < 14; i++) {
      const m = bottleMats[(i * 3 + Math.round(y * 10)) % bottleMats.length]!;
      const b = new THREE.Mesh(bottle, m);
      const bz = z - length / 2 + 0.25 + i * ((length - 0.5) / 13);
      b.position.set(wallX - 0.2, y + 0.165, bz);
      g.add(b);
      const n = new THREE.Mesh(neck, m);
      n.position.set(wallX - 0.2, y + 0.365, bz);
      g.add(n);
    }
  }

  // Stools on the room side of the counter.
  const seat = new THREE.CylinderGeometry(0.19, 0.19, 0.08, 20);
  const post = new THREE.CylinderGeometry(0.03, 0.03, 0.7, 10);
  const base = new THREE.CylinderGeometry(0.2, 0.22, 0.03, 20);
  const leatherMat = leather(1);
  for (let i = 0; i < 4; i++) {
    const sz = z - length / 2 + 0.9 + i * ((length - 1.8) / 3);
    const s = new THREE.Mesh(seat, leatherMat);
    s.position.set(x - 0.85, 0.74, sz);
    g.add(s);
    const p = new THREE.Mesh(post, brassMat);
    p.position.set(x - 0.85, 0.37, sz);
    g.add(p);
    const b = new THREE.Mesh(base, brassMat);
    b.position.set(x - 0.85, 0.015, sz);
    g.add(b);
  }

  // A few glasses on the counter.
  const glassGeometry = new THREE.CylinderGeometry(0.035, 0.03, 0.1, 12, 1, true);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  for (const dz of [-2.1, -0.6, 0.9, 2.3]) {
    const gl = new THREE.Mesh(glassGeometry, glassMat);
    gl.position.set(x - 0.15, 1.2, z + dz);
    g.add(gl);
  }

  // The bar's own light, warm, low over the counter.
  const light = new THREE.PointLight(0xffc27a, 40, 9, 2);
  light.position.set(x - 0.2, 2.6, z);
  g.add(light);
  return g;
}
