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
const geometry = new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 24);
const material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
const dummy = new THREE.Object3D();

/** A pile of chips worth some amount, at its own origin on the felt. */
export class ChipPile {
  readonly mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
  private amount = -1;

  constructor() {
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // its bounds change with every bet; culling a pile is not worth the bookkeeping
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
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
