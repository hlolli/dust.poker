import { expect, test } from "bun:test";
import * as THREE from "three";
import { ChipPile } from "./chips.ts";

test("a pile's culling bounds follow its columns as the pot grows and empties", () => {
  const pile = new ChipPile();
  const matrix = new THREE.Matrix4();
  for (const amount of [0, 5, 200, 7000, 1, 0]) {
    pile.set(amount);
    const { mesh } = pile;
    const bounds = mesh.boundingSphere!;
    expect(bounds.isEmpty()).toBe(amount === 0);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      const chip = mesh.geometry.boundingSphere!.clone().applyMatrix4(matrix);
      expect(bounds.center.distanceTo(chip.center) + chip.radius).toBeLessThanOrEqual(bounds.radius + 1e-8);
    }
  }
});
