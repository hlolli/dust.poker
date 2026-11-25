import type { BufferAttribute, SkinnedMesh } from "three";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import type { Avatar } from "./avatars.ts";

/** Keep the rig, skin weights, face shapes and UVs. Only the triangles drawn change.
 * Small parts such as the eyes and lashes already use few triangles. */
export async function reduceAvatarDetail(avatar: Avatar) {
  await MeshoptSimplifier.ready;
  avatar.root.traverse(object => {
    const mesh = object as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const geometry = mesh.geometry;
    const index = geometry.index;
    const position = geometry.getAttribute("position") as BufferAttribute;
    if (!index || index.count < 3000 || geometry.groups.length || geometry.drawRange.count < index.count ||
        !position.isBufferAttribute || !(position.array instanceof Float32Array) || position.itemSize !== 3) return;
    const target = 3 * Math.floor(index.count * 0.22 / 3);
    const [reduced] = MeshoptSimplifier.simplify(Uint32Array.from(index.array), position.array, 3, target, 0.005);
    index.array.set(reduced);
    index.needsUpdate = true;
    geometry.setDrawRange(0, reduced.length);
  });
}
