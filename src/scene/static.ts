import type * as THREE from "three";

/** Marks an object tree as never moving: compute world matrices once, stop per-frame updates. */
export function freeze(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.matrixWorldAutoUpdate = false;
  });
}
