import * as THREE from "three";
import { brass, carpet, chrome, darkWood, marbleBlack, plaster, stone, velvet } from "./materials.ts";

// The card room of a grand hotel, two eras welded together: Gaudi's organic structure
// (tree columns that branch into the vault, parabolic arches, round skylights of coloured
// glass, a trencadis mosaic in the floor) carrying a 1950s casino's glow (strings of warm
// bulbs, chrome, velvet, brass, a crystal chandelier). Built from geometry; only the
// material textures are assets.

export const ROOM = { width: 14, depth: 20, height: 8 };
const BAY = 4; // column spacing along the hall
const ARCADE_X = 5.5; // columns stand this far from the centre line
const SPRING = 4.2; // trunks end and branches begin at this height

/** A parabolic arch rib in the XY plane, apex at (0, rise), feet at (+-halfSpan, 0). */
function parabolicRib(halfSpan: number, rise: number, tube: number, material: THREE.Material): THREE.Mesh {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = -halfSpan + (i / 40) * 2 * halfSpan;
    pts.push(new THREE.Vector3(x, rise * (1 - (x / halfSpan) ** 2), 0));
  }
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, tube, 10, false), material);
}

/** A cylinder from `from` to `to`. */
function strut(from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const dir = to.clone().sub(from);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.8, radius, dir.length(), 12), material);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

/** Trencadis: broken tiles in Gaudi's palette on dark grout, as a repeating texture. */
function mosaicTexture(repeatX = 8, repeatY = 2): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#2a2622";
  ctx.fillRect(0, 0, 512, 512);
  const palette = ["#1f6fb2", "#2aa198", "#e0b341", "#f2ebdc", "#c8562f", "#8fbf4f", "#f2f2f2"];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let y = 0; y < 512; y += 24) {
    for (let x = 0; x < 512; x += 24) {
      ctx.fillStyle = palette[Math.floor(rnd() * palette.length)]!;
      const w = 16 + rnd() * 8;
      const h = 16 + rnd() * 8;
      ctx.beginPath();
      ctx.moveTo(x + rnd() * 4, y + rnd() * 4);
      ctx.lineTo(x + w, y + rnd() * 5);
      ctx.lineTo(x + w - rnd() * 6, y + h);
      ctx.lineTo(x + rnd() * 5, y + h - rnd() * 4);
      ctx.closePath();
      ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  return t;
}

/** Stained glass with organic cells, for windows and skylights. */
function glassTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#101418";
  ctx.fillRect(0, 0, 256, 512);
  // Deep, saturated glass in small cells; the leading is what reads from a distance.
  const palette = ["#0f5a48", "#173f8f", "#a8701c", "#8f2a1c", "#4a2a7a", "#b89a3a", "#1d6b7a"];
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 160; i++) {
    ctx.fillStyle = palette[Math.floor(rnd() * palette.length)]!;
    ctx.beginPath();
    ctx.ellipse(rnd() * 256, rnd() * 512, 9 + rnd() * 16, 12 + rnd() * 22, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#08080c";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createRoom(): THREE.Group {
  const g = new THREE.Group();
  g.name = "room";
  const { width: w, depth: d, height: h } = ROOM;
  const brassMat = brass();
  const stoneMat = stone(1);
  // Backlit glass: unlit, the texture is the light. Windows are cut as a shape, whose UVs
  // are the shape's own metres, so their copy of the texture is scaled to the window.
  const glassMat = new THREE.MeshBasicMaterial({ map: glassTexture(), side: THREE.DoubleSide });
  const windowGlass = glassTexture();
  windowGlass.repeat.set(0.5, 0.19);
  windowGlass.offset.set(0.5, 0.42);
  const windowGlassMat = new THREE.MeshBasicMaterial({ map: windowGlass, side: THREE.DoubleSide });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffc46b, emissiveIntensity: 2.4 });
  const bulbGeometry = new THREE.SphereGeometry(0.045, 10, 8);

  // Floor: black marble, a trencadis ring, the red rug under the table.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), marbleBlack(7));
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  // RingGeometry maps UVs flat across the disc, so an equal repeat keeps the tiles square.
  const mosaic = new THREE.Mesh(new THREE.RingGeometry(3.25, 4.3, 96), new THREE.MeshStandardMaterial({ map: mosaicTexture(5, 5), roughness: 0.5 }));
  mosaic.rotation.x = -Math.PI / 2;
  mosaic.position.y = 0.003;
  g.add(mosaic);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), carpet(4));
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.005;
  g.add(rug);

  // Walls as four planes (no box, so nothing shares a plane with the floor or ceiling),
  // dark wood to shoulder height, plaster above, a chrome line between them.
  const wallMat = plaster(6);
  const wainscotMat = darkWood(4);
  const chromeMat = chrome();
  const sides: [THREE.Vector3, number, number][] = [
    [new THREE.Vector3(0, 0, -d / 2), 0, w],
    [new THREE.Vector3(0, 0, d / 2), Math.PI, w],
    [new THREE.Vector3(-w / 2, 0, 0), Math.PI / 2, d],
    [new THREE.Vector3(w / 2, 0, 0), -Math.PI / 2, d],
  ];
  for (const [pos, ry, len] of sides) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, h), wallMat);
    wall.position.copy(pos).setY(h / 2);
    wall.rotation.y = ry;
    g.add(wall);
    const wainscot = new THREE.Mesh(new THREE.BoxGeometry(len, 1.4, 0.06), wainscotMat);
    wainscot.position.copy(pos).setY(0.71).add(new THREE.Vector3(0, 0, 0.04).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry));
    wainscot.rotation.y = ry;
    g.add(wainscot);
    const line = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.02), chromeMat);
    line.position.copy(pos).setY(1.43).add(new THREE.Vector3(0, 0, 0.06).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry));
    line.rotation.y = ry;
    g.add(line);
    // Brass picture rail where the arches spring, and a brass cornice under the ceiling.
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.04), brassMat);
    rail.position.copy(pos).setY(SPRING).add(new THREE.Vector3(0, 0, 0.02).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry));
    rail.rotation.y = ry;
    g.add(rail);
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(len, 0.16, 0.16), brassMat);
    cornice.position.copy(pos).setY(h - 0.08).add(new THREE.Vector3(0, 0, 0.08).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry));
    cornice.rotation.y = ry;
    g.add(cornice);
  }

  // Wall sconces: a brass cup with a glowing bulb on a dark wood pilaster, spaced along every wall.
  const cup = new THREE.SphereGeometry(0.15, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const sconceBulb = new THREE.SphereGeometry(0.07, 12, 8);
  const pilaster = new THREE.BoxGeometry(0.5, SPRING - 1.4, 0.08);
  const sconce = (pos: THREE.Vector3, ry: number) => {
    const inward = new THREE.Vector3(0, 0, 0.16).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    const p = new THREE.Mesh(pilaster, wainscotMat);
    p.position.copy(pos).setY((SPRING + 1.4) / 2).add(inward.clone().multiplyScalar(0.25));
    p.rotation.y = ry;
    g.add(p);
    const c = new THREE.Mesh(cup, brassMat);
    c.position.copy(pos).setY(2.6).add(inward);
    g.add(c);
    const b = new THREE.Mesh(sconceBulb, bulbMat);
    b.position.copy(pos).setY(2.72).add(inward);
    g.add(b);
  };
  for (let z = -8; z <= 8; z += 4) {
    sconce(new THREE.Vector3(-w / 2, 0, z), Math.PI / 2);
    sconce(new THREE.Vector3(w / 2, 0, z), -Math.PI / 2);
  }
  for (const x of [-4.5, -1.5, 1.5, 4.5]) {
    sconce(new THREE.Vector3(x, 0, -d / 2), 0);
    sconce(new THREE.Vector3(x, 0, d / 2), Math.PI);
  }
  // Smoked mirror panels between the pilasters of the entrance wall, brass-framed.
  const mirror = new THREE.PlaneGeometry(2.4, 2.4);
  const mirrorFrame = new THREE.BoxGeometry(2.56, 2.56, 0.04);
  for (const x of [-3, 0, 3]) {
    const f = new THREE.Mesh(mirrorFrame, brassMat);
    f.position.set(x, 2.8, d / 2 - 0.04);
    g.add(f);
    const m = new THREE.Mesh(mirror, chromeMat);
    m.position.set(x, 2.8, d / 2 - 0.07);
    m.rotation.y = Math.PI;
    g.add(m);
  }

  // Ceiling: night blue, with a great oculus of coloured glass over the table.
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0x0a1024, roughness: 1 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = h;
  g.add(ceiling);
  const oculus = new THREE.Mesh(new THREE.CircleGeometry(2.2, 64), glassMat);
  oculus.rotation.x = Math.PI / 2;
  oculus.position.y = h - 0.02;
  g.add(oculus);
  const oculusRim = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.06, 10, 64), brassMat);
  oculusRim.rotation.x = Math.PI / 2;
  oculusRim.position.y = h - 0.04;
  g.add(oculusRim);

  // Tree columns: a stone trunk that splits into four branches reaching the vault, with a
  // small round skylight where each branch meets the ceiling. Parabolic brass arches run
  // along the arcade and across the nave, each hung with a string of bulbs.
  const trunk = new THREE.CylinderGeometry(0.26, 0.34, SPRING, 20);
  const trunkMat = new THREE.MeshStandardMaterial({ map: mosaicTexture(2, 3), roughness: 0.45 }); // trencadis-clad, as at Park Guell
  const collar = new THREE.TorusGeometry(0.34, 0.05, 10, 32);
  const skylight = new THREE.CircleGeometry(0.45, 32);
  const bays = Math.floor(d / BAY) - 1;
  for (let i = 0; i <= bays; i++) {
    const z = -((bays * BAY) / 2) + i * BAY;
    for (const x of [-ARCADE_X, ARCADE_X]) {
      const t = new THREE.Mesh(trunk, trunkMat);
      t.position.set(x, SPRING / 2, z);
      g.add(t);
      const c = new THREE.Mesh(collar, brassMat);
      c.rotation.x = Math.PI / 2;
      c.position.set(x, SPRING, z);
      g.add(c);
      const knot = new THREE.Vector3(x, SPRING, z);
      const inward = x < 0 ? 1 : -1;
      for (const tip of [
        new THREE.Vector3(x + inward * 1.6, h, z),
        new THREE.Vector3(x - inward * 0.9, h, z),
        new THREE.Vector3(x, h, z + 1.7),
        new THREE.Vector3(x, h, z - 1.7),
      ]) {
        g.add(strut(knot, tip, 0.13, stoneMat));
        const sk = new THREE.Mesh(skylight, glassMat);
        sk.rotation.x = Math.PI / 2;
        sk.position.copy(tip).setY(h - 0.02);
        g.add(sk);
      }
      if (i < bays) {
        const arch = parabolicRib(BAY / 2, 2.4, 0.06, brassMat);
        arch.rotation.y = Math.PI / 2;
        arch.position.set(x, SPRING, z + BAY / 2);
        g.add(arch);
        for (let k = 1; k < 8; k++) {
          const u = -1 + (k / 8) * 2;
          const b = new THREE.Mesh(bulbGeometry, bulbMat);
          b.position.set(x, SPRING + 2.4 * (1 - u * u) - 0.14, z + BAY / 2 + u * (BAY / 2));
          g.add(b);
        }
      }
    }
    const rib = parabolicRib(ARCADE_X, h - 0.3 - SPRING, 0.06, brassMat);
    rib.position.set(0, SPRING, z);
    g.add(rib);
    for (let k = 1; k < 14; k++) {
      const u = -1 + (k / 14) * 2;
      const b = new THREE.Mesh(bulbGeometry, bulbMat);
      b.position.set(u * ARCADE_X, SPRING + (h - 0.3 - SPRING) * (1 - u * u) - 0.14, z);
      g.add(b);
    }
  }

  // Tall round-headed windows in the long walls, one per bay, organic glass; burgundy drapes beside them.
  const windowShape = new THREE.Shape();
  windowShape.moveTo(-0.95, -2.1);
  windowShape.lineTo(0.95, -2.1);
  windowShape.lineTo(0.95, 2.1);
  windowShape.absarc(0, 2.1, 0.95, 0, Math.PI, false);
  windowShape.lineTo(-0.95, -2.1);
  const windowGeometry = new THREE.ShapeGeometry(windowShape, 24);
  const drape = new THREE.BoxGeometry(0.5, 6.4, 0.25);
  const drapeMat = velvet(0x5a0f1f, 2);
  for (let i = 0; i < bays; i++) {
    const z = -((bays * BAY) / 2) + i * BAY + BAY / 2;
    for (const side of [-1, 1]) {
      const win = new THREE.Mesh(windowGeometry, windowGlassMat);
      win.position.set(side * (w / 2 - 0.05), 4.0, z);
      win.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(win);
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.04, 8, 32, Math.PI), brassMat);
      frame.position.set(side * (w / 2 - 0.08), 6.1, z);
      frame.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(frame);
      for (const dz of [-1.35, 1.35]) {
        const dr = new THREE.Mesh(drape, drapeMat);
        dr.position.set(side * (w / 2 - 0.3), 3.4, z + dz);
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

  // Lights: the chandelier, moonlight through the windows, and a warm fill. The bar adds one.
  const light = new THREE.PointLight(0xffd6a0, 260, 30, 2);
  light.position.y = 5.2;
  g.add(light);
  const moon = new THREE.DirectionalLight(0x8fb3ff, 0.6);
  moon.position.set(8, 6, -4);
  g.add(moon);
  g.add(new THREE.HemisphereLight(0xffe2b8, 0x1a0e08, 1.0));

  return g;
}
