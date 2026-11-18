import * as THREE from "three";
import { brass, carpet, cells, chrome, darkWood, marbleBlack, plaster, stone, velvet } from "./materials.ts";

// The card room of a grand hotel, two eras welded together: Gaudi's organic structure
// (tree columns that branch into the vault, parabolic arches, round skylights of coloured
// glass, a trencadis mosaic in the floor) carrying a 1950s casino's glow (strings of warm
// bulbs, chrome, velvet, brass, a crystal chandelier). Built from geometry; only the
// material textures are assets.

export const ROOM = { width: 14, depth: 20, height: 8 };
const BAY = 4; // column spacing along the hall
const ARCADE_X = 5.5; // columns stand this far from the centre line
const SPRING = 4.2; // trunks end and branches begin at this height
const SCONCE_HEIGHT = 2.72;

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

/** A seeded random in [0, 1): the same room on every visit. */
function seeded(seed: number): () => number {
  return () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
}

/** Paints cells into a canvas texture: a colour per cell, a line of `lineColor` `lineWidth` px wide between them. */
function cellTexture(w: number, h: number, cols: number, rows: number, seed: number, colour: (rnd: () => number) => [number, number, number], lineColor: [number, number, number], lineWidth: number, shade: number): THREE.CanvasTexture {
  const rnd = seeded(seed);
  const { owner, edge, count } = cells(w, h, cols, rows, rnd);
  const fills = Array.from({ length: count }, () => colour(rnd));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = fills[owner[i]!]!;
    // Softly darker towards the border, as glass is thicker and glaze pools at a shard's edge.
    const e = edge[i]!;
    const t = e < lineWidth ? 1 : 0;
    const k = 1 - shade * Math.exp(-(e - lineWidth) / 6);
    img.data[i * 4] = t ? lineColor[0] : r * k;
    img.data[i * 4 + 1] = t ? lineColor[1] : g * k;
    img.data[i * 4 + 2] = t ? lineColor[2] : b * k;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

const hex = (s: string): [number, number, number] => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
/** Picks from `palette` with the weights given, and varies the pick's brightness a little. */
const weighted = (palette: [string, number][], vary: number) => (rnd: () => number): [number, number, number] => {
  let x = rnd() * palette.reduce((s, [, wt]) => s + wt, 0);
  const [colour] = palette.find(([, wt]) => (x -= wt) < 0) ?? palette[0]!;
  const k = 1 - vary / 2 + rnd() * vary;
  return hex(colour).map((v) => Math.min(255, v * k)) as [number, number, number];
};

/** Trencadis: broken glazed tiles on pale grout, mostly white and cobalt with ochre and green, as at Park Guell. */
function mosaicTexture(repeatX = 8, repeatY = 2): THREE.CanvasTexture {
  const palette: [string, number][] = [["#ece6d6", 5], ["#1d4f9a", 4], ["#3f7fc4", 2], ["#d9a530", 1.4], ["#4f8a4a", 1], ["#b8452c", 0.6]];
  const t = cellTexture(256, 256, 11, 11, 7, weighted(palette, 0.25), [178, 170, 152], 1.6, 0.18);
  t.repeat.set(repeatX, repeatY);
  return t;
}

/** Stained glass in leaded cells, for windows and skylights: deep colours, lit from outside at night. */
function glassTexture(): THREE.CanvasTexture {
  const palette: [string, number][] = [["#173f8f", 4], ["#0f5a48", 3], ["#1d6b7a", 2], ["#a8701c", 1.5], ["#8f2a1c", 1.2], ["#4a2a7a", 1.5], ["#c9a650", 0.6]];
  return cellTexture(256, 512, 7, 13, 3, weighted(palette, 0.35), [10, 10, 12], 2.2, 0.45);
}

/** Warm spill above each brass sconce. The wall and fixtures are fixed, so sample the
 * irradiance once in wall coordinates instead of evaluating 18 lights on every surface. */
function sconceWall(length: number, bulbs: number[]): THREE.MeshStandardMaterial {
  const height = ROOM.height;
  const widthPx = Math.ceil(length * 16);
  const heightPx = height * 16;
  const pixels = new Uint8Array(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y++) {
    const dy = (y + 0.5) / heightPx * height - SCONCE_HEIGHT;
    // The cup blocks light below its rim.
    const upward = THREE.MathUtils.smoothstep(dy, -0.35, 0.25);
    for (let x = 0; x < widthPx; x++) {
      const metres = ((x + 0.5) / widthPx - 0.5) * length;
      let spill = 0;
      for (const bulb of bulbs) {
        const d2 = (metres - bulb) ** 2 + dy ** 2 + 0.4 ** 2;
        spill += 0.4 / (d2 * Math.sqrt(d2));
      }
      const value = Math.min(1, spill * upward * 0.38);
      const offset = 4 * (y * widthPx + x);
      pixels[offset] = Math.round(value * 255);
      pixels[offset + 1] = Math.round(value * 147);
      pixels[offset + 2] = Math.round(value * 64);
      pixels[offset + 3] = 255;
    }
  }
  const map = new THREE.DataTexture(pixels, widthPx, heightPx);
  map.magFilter = map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  const wall = plaster(6);
  wall.lightMap = map;
  wall.lightMapIntensity = 4;
  return wall;
}

export function createRoom(): THREE.Group {
  const g = new THREE.Group();
  g.name = "room";
  const { width: w, depth: d, height: h } = ROOM;
  const brassMat = brass();
  const stoneMat = stone(1);
  // Backlit glass: unlit, the texture is the light. Windows are cut as a shape, whose UVs
  // are the shape's own metres, so their copy of the texture is scaled to the window.
  // Night: the glass glows faintly with what comes in from outside, never brighter than the lamps inside.
  const glassMat = new THREE.MeshBasicMaterial({ map: glassTexture(), color: 0x8a8a9a, side: THREE.DoubleSide });
  const windowGlass = glassTexture();
  windowGlass.repeat.set(0.5, 0.19);
  windowGlass.offset.set(0.5, 0.42);
  const windowGlassMat = new THREE.MeshBasicMaterial({ map: windowGlass, color: 0x6a6f86, side: THREE.DoubleSide });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffc46b, emissiveIntensity: 2.4 });
  const bulbGeometry = new THREE.SphereGeometry(0.045, 8, 6);

  // Floor: black marble, a trencadis ring, the red rug under the table.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), marbleBlack(7));
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  // RingGeometry maps UVs flat across the disc, so an equal repeat keeps the tiles square.
  const mosaic = new THREE.Mesh(new THREE.RingGeometry(3.25, 4.3, 96), new THREE.MeshStandardMaterial({ map: mosaicTexture(9, 9), roughness: 0.3 }));
  mosaic.rotation.x = -Math.PI / 2;
  mosaic.position.y = 0.003;
  g.add(mosaic);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), carpet(4));
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.005;
  g.add(rug);
  floor.receiveShadow = mosaic.receiveShadow = rug.receiveShadow = true;

  // Walls as four planes (no box, so nothing shares a plane with the floor or ceiling),
  // dark wood to shoulder height, plaster above, a chrome line between them.
  const endBulbs = [-4.5, -1.5, 1.5, 4.5];
  const sideBulbs = [-8, -4, 0, 4, 8];
  const endWall = sconceWall(w, endBulbs);
  const sideWall = sconceWall(d, sideBulbs);
  const wainscotMat = darkWood(4);
  const chromeMat = chrome();
  const cup = new THREE.SphereGeometry(0.15, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const sconceBulb = new THREE.SphereGeometry(0.07, 12, 8);
  const pilaster = new THREE.BoxGeometry(0.5, SPRING - 1.4, 0.08);
  const placement = new THREE.Matrix4();
  const sides: [THREE.Vector3, number, number, THREE.Material, number[]][] = [
    [new THREE.Vector3(0, 0, -d / 2), 0, w, endWall, endBulbs],
    [new THREE.Vector3(0, 0, d / 2), Math.PI, w, endWall, endBulbs],
    [new THREE.Vector3(-w / 2, 0, 0), Math.PI / 2, d, sideWall, sideBulbs],
    [new THREE.Vector3(w / 2, 0, 0), -Math.PI / 2, d, sideWall, sideBulbs],
  ];
  for (const [pos, ry, len, wallMaterial, bulbOffsets] of sides) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, h), wallMaterial);
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

    // Each wall's sconces share three draws. Their offsets also place the light on the plaster.
    const sconces = new THREE.Group();
    sconces.position.copy(pos);
    sconces.rotation.y = ry;
    const posts = new THREE.InstancedMesh(pilaster, wainscotMat, bulbOffsets.length);
    const cups = new THREE.InstancedMesh(cup, brassMat, bulbOffsets.length);
    const bulbs = new THREE.InstancedMesh(sconceBulb, bulbMat, bulbOffsets.length);
    bulbOffsets.forEach((x, i) => {
      posts.setMatrixAt(i, placement.makeTranslation(x, (SPRING + 1.4) / 2, 0.04));
      cups.setMatrixAt(i, placement.makeTranslation(x, 2.6, 0.16));
      bulbs.setMatrixAt(i, placement.makeTranslation(x, SCONCE_HEIGHT, 0.16));
    });
    sconces.add(posts, cups, bulbs);
    g.add(sconces);
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
  const trunkMat = new THREE.MeshStandardMaterial({ map: mosaicTexture(3, 6), roughness: 0.28 }); // trencadis-clad and glazed, as at Park Guell
  const collar = new THREE.TorusGeometry(0.34, 0.05, 10, 32);
  const skylight = new THREE.CircleGeometry(0.45, 32);
  const bays = Math.floor(d / BAY) - 1;
  // Keep a string on its own rib so looking down at the felt also culls its bulbs.
  function litRib(span: number, rise: number, count: number): THREE.Mesh {
    const rib = parabolicRib(span, rise, 0.06, brassMat);
    const bulbs = new THREE.InstancedMesh(bulbGeometry, bulbMat, count);
    for (let i = 0; i < count; i++) {
      const u = 2 * (i + 1) / (count + 1) - 1;
      bulbs.setMatrixAt(i, placement.makeTranslation(u * span, rise * (1 - u * u) - 0.14, 0));
    }
    rib.add(bulbs);
    return rib;
  }
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
        const arch = litRib(BAY / 2, 2.4, 7);
        arch.rotation.y = Math.PI / 2;
        arch.position.set(x, SPRING, z + BAY / 2);
        g.add(arch);
      }
    }
    const rib = litRib(ARCADE_X, h - 0.3 - SPRING, 13);
    rib.position.set(0, SPRING, z);
    g.add(rib);
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
    const drops = new THREE.InstancedMesh(bulbGeometry, crystal, count);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      drops.setMatrixAt(i, placement.makeTranslation(Math.cos(a) * radius, y - 0.12, Math.sin(a) * radius));
    }
    chandelier.add(drops);
  }
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, h - 6.0, 8), brassMat);
  chain.position.y = (h + 6.0) / 2;
  chandelier.add(chain);
  g.add(chandelier);

  // Lights: the chandelier, moonlight through the windows, and a warm fill. The bar adds one.
  const light = new THREE.PointLight(0xffddb5, 155, 30, 2);
  light.position.y = 5.2;
  g.add(light);
  const moon = new THREE.DirectionalLight(0x8fb3ff, 0.6);
  moon.position.set(8, 6, -4);
  g.add(moon);
  // A faint fill only: the bounce light comes from the hall's own reflection (fx.ts, reflectRoom).
  g.add(new THREE.HemisphereLight(0xffe2b8, 0x1a0e08, 0.25));

  return g;
}
