import * as THREE from "three";

// Chips: 1 white, 5 red, and 25 green for the part of a pile above 300, so a buy-in of 200
// stands as forty reds in four columns rather than eight greens, and a big pot still fits.
// Stacked in columns of up to ten, side by side. One instanced mesh per pile: one draw call.
const WHITE = new THREE.Color(0xe8e0cc);
const RED = new THREE.Color(0xa8141c);
const GREEN = new THREE.Color(0x1f6f3a);
const GREENS_ABOVE = 300;
const RADIUS = 0.021;
const HEIGHT = 0.004;
const COLUMN = 10;
const CAPACITY = 200;
// A small bevel catches the lamp between stacked chips. The contrasting clay inserts
// wrap from the face across the rim, so the denomination is still visible edge-on.
const half = HEIGHT / 2;
const bevel = 0.0004;
const profile = [[0, -half], [RADIUS - bevel, -half], [RADIUS, half - bevel], [RADIUS - bevel, half], [0, half]] as const;
const geometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 18);
// Project the same face pattern onto the bevel and side so each insert is continuous.
const positions = geometry.getAttribute("position");
const uv = geometry.getAttribute("uv");
for (let i = 0; i < uv.count; i++) {
  uv.setXY(i, 0.5 + positions.getX(i) / (2 * RADIUS), 0.5 + positions.getZ(i) / (2 * RADIUS));
}

function chipInlay(): THREE.DataTexture {
  const size = 128;
  const mask = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = 2 * (x + 0.5) / size - 1;
      const v = 2 * (y + 0.5) / size - 1;
      const radius = Math.hypot(u, v);
      const edgeSpot = radius > 0.75 && Math.cos(6 * Math.atan2(v, u)) > 0.5;
      mask[y * size + x] = edgeSpot || Math.abs(radius - 0.59) < 0.025 ? 255 : 0;
    }
  }
  const map = new THREE.DataTexture(mask, size, size, THREE.RedFormat);
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

const material = new THREE.MeshStandardMaterial({ map: chipInlay(), roughness: 0.72 });
// Use the denomination and the inlay mask together in a single instanced draw.
material.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", "").replace(
    "#include <color_fragment>",
    `#include <color_fragment>
    #ifdef USE_COLOR
      vec3 spot = vColor.r > 0.7 ? vec3(0.035, 0.065, 0.11) : vec3(0.82, 0.76, 0.62);
      diffuseColor.rgb = mix(diffuseColor.rgb, spot, texture2D(map, vMapUv).r);
    #endif`,
  );
};
const dummy = new THREE.Object3D();

/** A pile of chips worth some amount, at its own origin on the felt. */
export class ChipPile {
  readonly mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
  private amount = -1;

  constructor() {
    this.mesh.count = 0;
    this.mesh.castShadow = this.mesh.receiveShadow = true; // costs nothing while the renderer's shadow map is off
  }

  set(amount: number) {
    if (amount === this.amount) return;
    this.amount = amount;
    const chips: THREE.Color[] = [];
    let left = Math.max(0, Math.floor(amount));
    const greens = left > GREENS_ABOVE ? Math.floor((left - GREENS_ABOVE) / 25) : 0;
    left -= greens * 25;
    const reds = Math.floor(left / 5);
    const whites = left - reds * 5;
    for (const [n, color] of [[greens, GREEN], [reds, RED], [whites, WHITE]] as const) {
      for (let i = 0; i < n && chips.length < CAPACITY; i++) chips.push(color);
    }
    // Columns in a tight cluster: a row of three, then a row behind.
    chips.forEach((color, i) => {
      const column = Math.floor(i / COLUMN);
      const row = Math.floor(column / 3);
      dummy.position.set(((column % 3) - 1) * (RADIUS * 2.15) + (row % 2) * RADIUS, HEIGHT / 2 + (i % COLUMN) * HEIGHT, -row * RADIUS * 2.15);
      dummy.rotation.y = (i * 0.7) % Math.PI; // a little turn per chip so the edges do not align
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      this.mesh.setColorAt(i, color);
    });
    this.mesh.count = chips.length;
    this.mesh.computeBoundingSphere(); // the stack grows and gains columns as bets come in
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
