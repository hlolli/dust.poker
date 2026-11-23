import { expect, spyOn, test } from "bun:test";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { dealerReach, loadAvatar, poseDealer } from "./avatars.ts";
import { Life } from "./life.ts";
import { MODELS, STAFF } from "./models.ts";

// Load the shipped rigs and morphs without a browser image decoder.
const geometryLoader = new GLTFLoader().register(() => ({
  name: "geometry-only",
  loadMaterial: async () => new THREE.MeshStandardMaterial(),
}));
const loadFiles = () => spyOn(GLTFLoader.prototype, "loadAsync").mockImplementation(async (url) =>
  geometryLoader.parseAsync(await Bun.file(url).arrayBuffer(), ""));

test("the cast's culling bounds enclose every weighted vertex through joint rotations and facial expressions", async () => {
  const files = loadFiles();
  try {
    for (const url of [...MODELS.map((m) => m.url), ...Object.values(STAFF)]) {
      const { root, bones } = await loadAvatar(url);
      const hips = bones.get("Bip01 Pelvis")!;
      const centre = hips.getWorldPosition(new THREE.Vector3());
      root.traverse((part) => {
        if (!(part instanceof THREE.SkinnedMesh)) return;
        expect(part.frustumCulled).toBe(true);
        const bounds = part.boundingSphere!.clone().applyMatrix4(part.matrixWorld);
        expect(bounds.center.distanceTo(centre)).toBeLessThan(1e-5);
        const g = part.geometry;
        const pivots = part.skeleton.bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
        const reach = part.skeleton.bones.map((bone) => {
          // A rotating chain can extend at most the sum of its link lengths.
          let joint: THREE.Object3D = bone;
          let length = 0;
          while (joint !== hips && joint.parent && joint !== hips.parent) {
            length += joint.position.length();
            joint = joint.parent;
          }
          return length + (joint === hips ? 0 : joint.getWorldPosition(new THREE.Vector3()).distanceTo(centre));
        });
        const position = g.getAttribute("position"), joints = g.getAttribute("skinIndex"), weights = g.getAttribute("skinWeight");
        const vertex = new THREE.Vector3(), delta = new THREE.Vector3();
        let furthest = 0;
        for (let i = 0; i < position.count; i++) {
          vertex.fromBufferAttribute(position, i).applyMatrix4(part.matrixWorld);
          let distance = 0;
          for (let k = 0; k < 4; k++) {
            const j = joints.getComponent(i, k);
            distance += weights.getComponent(i, k) * (reach[j]! + pivots[j]!.distanceTo(vertex));
          }
          for (const shape of g.morphAttributes.position ?? []) distance += delta.fromBufferAttribute(shape, i).length();
          furthest = Math.max(furthest, distance);
        }
        expect(furthest).toBeLessThan(bounds.radius);
      });
    }
  } finally {
    files.mockRestore();
  }
});

test("aiming the dealer's arm and gaze updates the required bones without walking unrelated meshes", async () => {
  const files = loadFiles();
  try {
    const dealer = await loadAvatar(STAFF.dealer);
    poseDealer(dealer);
    const life = new Life(dealer, { seed: 11, standing: true });
    const update = spyOn(dealer.mesh, "updateMatrixWorld");
    const before = dealer.hand("R").getWorldPosition(new THREE.Vector3());
    const focus = new THREE.Vector3(0, 1, 1);
    dealerReach(dealer, focus);
    life.apply(1000, { focus, others: [], deciding: false });
    expect(dealer.hand("R").getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeGreaterThan(0.1);
    expect(update).not.toHaveBeenCalled();
    life.restore();
  } finally {
    files.mockRestore();
  }
});
