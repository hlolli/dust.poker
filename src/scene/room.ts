import * as THREE from "three";
import { brass, carpet, darkWood, marbleBlack, marbleWhite, plaster, velvet } from "./materials.ts";

// The card room of a grand hotel: a neo-gothic hall with an arcade of clustered columns
// and pointed arches down both sides, a ribbed vault, tall lancet windows, one great
// chandelier over the table. Black marble underfoot, red carpet at the table, dark wood
// to shoulder height, brass everywhere the eye lands. Built from geometry; only the
// material textures are assets.

export const ROOM = { width: 14, depth: 20, height: 8 };
const BAY = 4; // column spacing along the hall
const ARCADE_X = 5.5; // columns stand this far from the centre line
const SPRING = 4.5; // arches spring from this height

/** A pointed (equilateral) arch as a round rib: two circular arcs meeting at the apex. */
function pointedRib(span: number, tube: number, material: THREE.Material): THREE.Mesh {
  const path = new THREE.CurvePath<THREE.Vector2>();
  // Right-hand arc drawn from the left springer up to the apex, centred on the right springer.
  path.add(new THREE.EllipseCurve(span / 2, 0, span, span, Math.PI, (2 * Math.PI) / 3, true));
  path.add(new THREE.EllipseCurve(-span / 2, 0, span, span, Math.PI / 3, 0, true));
  const pts3 = path.getPoints(48).map((p) => new THREE.Vector3(p.x, p.y, 0));
  const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts3), 64, tube, 10, false);
  return new THREE.Mesh(geometry, material);
}

/** A wide, lower transverse rib across the nave (elliptical, so it fits under the vault). */
function transverseRib(halfSpan: number, rise: number, tube: number, material: THREE.Material): THREE.Mesh {
  const path = new THREE.CurvePath<THREE.Vector2>();
  path.add(new THREE.EllipseCurve(0, 0, halfSpan, rise, Math.PI, Math.PI / 2, true));
  path.add(new THREE.EllipseCurve(0, 0, halfSpan, rise, Math.PI / 2, 0, true));
  const pts3 = path.getPoints(48).map((p) => new THREE.Vector3(p.x, p.y, 0));
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts3), 64, tube, 10, false), material);
}

/** Lancet window outline: a rectangle topped by a pointed arch, as a filled shape. */
function lancetShape(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-w / 2, h);
  s.absarc(w / 2, h, w, Math.PI, (2 * Math.PI) / 3, true);
  s.absarc(-w / 2, h, w, Math.PI / 3, 0, true);
  s.lineTo(w / 2, 0);
  s.closePath();
  return s;
}

function stainedGlass(): THREE.MeshStandardMaterial {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#1b2a6b");
  g.addColorStop(0.45, "#4a2a7a");
  g.addColorStop(0.7, "#b8862b");
  g.addColorStop(1, "#1b2a6b");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 512);
  ctx.strokeStyle = "#0a0a12";
  ctx.lineWidth = 6;
  for (let y = 0; y <= 512; y += 64) ctx.strokeRect(0, y, 256, 64);
  for (let x = 64; x < 256; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 1.6, roughness: 0.4 });
}

export function createRoom(): THREE.Group {
  const g = new THREE.Group();
  g.name = "room";
  const { width: w, depth: d, height: h } = ROOM;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), marbleBlack(7));
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);

  const rug = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), carpet(4));
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.004;
  g.add(rug);

  // Walls and wainscot are inside-out boxes; their bottoms sit a hair above the floor so the
  // two planes never fight for the same depth.
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), Object.assign(plaster(6), { side: THREE.BackSide }));
  walls.position.y = h / 2 + 0.01;
  g.add(walls);

  const wainscot = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, 1.4, d - 0.04), Object.assign(darkWood(4), { side: THREE.BackSide }));
  wainscot.position.y = 0.7 + 0.02;
  g.add(wainscot);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0x0c0f1c, roughness: 1 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = h;
  g.add(ceiling);

  // Arcades: clustered white-marble columns with brass rings, pointed arches between them,
  // and a transverse brass rib across the nave at every column pair.
  const column = new THREE.CylinderGeometry(0.28, 0.32, SPRING, 20);
  const columnMat = marbleWhite(1);
  const ring = new THREE.TorusGeometry(0.34, 0.04, 10, 32);
  const brassMat = brass();
  const bays = Math.floor(d / BAY) - 1; // columns at z = -8, -4, 0, 4, 8
  for (let i = 0; i <= bays; i++) {
    const z = -((bays * BAY) / 2) + i * BAY;
    for (const x of [-ARCADE_X, ARCADE_X]) {
      const c = new THREE.Mesh(column, columnMat);
      c.position.set(x, SPRING / 2, z);
      g.add(c);
      for (const y of [0.15, SPRING - 0.15]) {
        const r = new THREE.Mesh(ring, brassMat);
        r.rotation.x = Math.PI / 2;
        r.position.set(x, y, z);
        g.add(r);
      }
      if (i < bays) {
        const arch = pointedRib(BAY, 0.07, brassMat);
        arch.rotation.y = Math.PI / 2;
        arch.position.set(x, SPRING, z + BAY / 2);
        g.add(arch);
      }
    }
    const rib = transverseRib(ARCADE_X, h - 0.25 - SPRING, 0.07, brassMat);
    rib.position.set(0, SPRING, z);
    g.add(rib);
  }

  // Lancet windows on both long walls, one per bay, glowing; burgundy drapes beside them.
  const glass = stainedGlass();
  const lancet = new THREE.ShapeGeometry(lancetShape(1.5, 3.0), 24);
  const drape = new THREE.BoxGeometry(0.5, 6.2, 0.25);
  const drapeMat = velvet(0x5a0f1f, 2);
  for (let i = 0; i < bays; i++) {
    const z = -((bays * BAY) / 2) + i * BAY + BAY / 2;
    for (const side of [-1, 1]) {
      const win = new THREE.Mesh(lancet, glass);
      win.position.set(side * (w / 2 - 0.05), 2.0, z);
      win.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(win);
      for (const dz of [-1.2, 1.2]) {
        const dr = new THREE.Mesh(drape, drapeMat);
        dr.position.set(side * (w / 2 - 0.3), 3.3, z + dz);
        g.add(dr);
      }
    }
  }

  // The great chandelier: three brass tiers hung with crystal, over the table.
  const crystal = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffd28a, emissiveIntensity: 2.2, roughness: 0.2 });
  const drop = new THREE.SphereGeometry(0.045, 10, 8);
  const chandelier = new THREE.Group();
  chandelier.name = "chandelier";
  for (const [radius, y, count] of [
    [1.3, 5.0, 24],
    [0.9, 5.5, 16],
    [0.5, 6.0, 10],
  ] as const) {
    const tier = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035, 10, 64), brassMat);
    tier.rotation.x = Math.PI / 2;
    tier.position.y = y;
    chandelier.add(tier);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const dr = new THREE.Mesh(drop, crystal);
      dr.position.set(Math.cos(a) * radius, y - 0.12, Math.sin(a) * radius);
      chandelier.add(dr);
    }
  }
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, h - 6.0, 8), brassMat);
  chain.position.y = (h + 6.0) / 2;
  chandelier.add(chain);
  g.add(chandelier);

  // Three lights: the chandelier, moonlight through the windows, and a warm fill.
  const light = new THREE.PointLight(0xffd6a0, 260, 30, 2);
  light.position.y = 5.2;
  g.add(light);
  const moon = new THREE.DirectionalLight(0x8fb3ff, 0.7);
  moon.position.set(8, 6, -4);
  g.add(moon);
  g.add(new THREE.HemisphereLight(0xffe2b8, 0x1a0e08, 0.9));

  return g;
}
