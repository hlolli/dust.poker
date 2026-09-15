import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Rocketbox avatars (MIT, see LICENSES.md): a 3ds Max Biped rig ("Bip01 ..." bones) and one
// skinned mesh with the 52 ARKit face shape keys ("AK_09_EyeBlinkLeft", ...).

export interface Avatar {
  root: THREE.Group;
  bones: Map<string, THREE.Bone>;
  mesh: THREE.SkinnedMesh;
  /** Attach things to a hand here: the palm of the right or left hand. */
  hand(side: "L" | "R"): THREE.Bone;
  /** Set an ARKit blendshape by its short name, e.g. "EyeBlinkLeft", to a weight 0..1. */
  face(name: string, weight: number): void;
}

const loader = new GLTFLoader();

export async function loadAvatar(url: string): Promise<Avatar> {
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;
  const bones = new Map<string, THREE.Bone>();
  let mesh: THREE.SkinnedMesh | undefined;
  root.traverse((o) => {
    // The glTF exporter writes "Bip01 L Thigh" as "Bip01_L_Thigh"; key bones by the Biped name.
    if ((o as THREE.Bone).isBone) bones.set(o.name.replace(/_/g, " "), o as THREE.Bone);
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  if (!mesh) throw new Error(`${url}: no skinned mesh`);
  const m = mesh;
  m.frustumCulled = false; // posed bones move vertices far from the rest-pose bounds
  const morphs = m.morphTargetDictionary ?? {};
  const morphIndex = new Map<string, number>();
  for (const key of Object.keys(morphs)) morphIndex.set(key.replace(/^AK_\d+_/, ""), morphs[key]!);

  const bone = (name: string) => {
    const b = bones.get(name);
    if (!b) throw new Error(`${url}: no bone ${name}`);
    return b;
  };
  return {
    root,
    bones,
    mesh: m,
    hand: (side) => bone(`Bip01 ${side} Hand`),
    face: (name, weight) => {
      const i = morphIndex.get(name);
      if (i !== undefined && m.morphTargetInfluences) m.morphTargetInfluences[i] = weight;
    },
  };
}

/** Rotates a bone about an axis given in the avatar root's space, on top of its current pose. */
function turn(avatar: Avatar, boneName: string, axis: THREE.Vector3, degrees: number) {
  const b = avatar.bones.get(boneName);
  if (!b?.parent) return;
  const parentWorld = new THREE.Quaternion();
  b.parent.getWorldQuaternion(parentWorld);
  const rootWorld = new THREE.Quaternion();
  avatar.root.getWorldQuaternion(rootWorld);
  // axis: root space -> world -> parent space
  const a = axis.clone().normalize().applyQuaternion(rootWorld).applyQuaternion(parentWorld.invert());
  b.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(a, THREE.MathUtils.degToRad(degrees)));
}

const X = new THREE.Vector3(1, 0, 0);

/**
 * Rotates `boneName` so that the direction to `childName` points along `dirRoot` (root space,
 * where the character faces +z). Independent of how the rest pose is built.
 */
function aim(avatar: Avatar, boneName: string, childName: string, dirRoot: THREE.Vector3) {
  const b = avatar.bones.get(boneName);
  const c = avatar.bones.get(childName);
  if (!b?.parent || !c) return;
  avatar.root.updateMatrixWorld(true);
  const bw = new THREE.Vector3();
  const cw = new THREE.Vector3();
  b.getWorldPosition(bw);
  c.getWorldPosition(cw);
  const current = cw.sub(bw).normalize();
  const rootWorld = new THREE.Quaternion();
  avatar.root.getWorldQuaternion(rootWorld);
  const desired = dirRoot.clone().normalize().applyQuaternion(rootWorld);
  const q = new THREE.Quaternion().setFromUnitVectors(current, desired); // world space
  const pw = new THREE.Quaternion();
  b.parent.getWorldQuaternion(pw);
  const local = pw.clone().invert().multiply(q).multiply(pw); // same rotation, parent space
  b.quaternion.premultiply(local);
}

/** Like `aim`, toward a point given in root space. */
function aimAt(avatar: Avatar, boneName: string, childName: string, targetRoot: THREE.Vector3) {
  const b = avatar.bones.get(boneName);
  if (!b) return;
  avatar.root.updateMatrixWorld(true);
  const bw = new THREE.Vector3();
  b.getWorldPosition(bw);
  const bRoot = avatar.root.worldToLocal(bw);
  aim(avatar, boneName, childName, targetRoot.clone().sub(bRoot));
}

/**
 * Sits the avatar on a chair whose seat is at `seatHeight`, facing +z in root space:
 * thighs forward, shins down, upper arms down and a little forward, forearms in to a hand
 * target just in front of the chest, where the cards are held.
 */
export function poseSeated(avatar: Avatar, seatHeight = 0.5) {
  avatar.root.updateMatrixWorld(true);
  const neck = new THREE.Vector3();
  avatar.bones.get("Bip01 Neck")?.getWorldPosition(neck);
  avatar.root.worldToLocal(neck);
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1; // facing +z, the character's left is +x
    aim(avatar, `Bip01 ${side} Thigh`, `Bip01 ${side} Calf`, new THREE.Vector3(s * 0.1, -0.12, 1));
    aim(avatar, `Bip01 ${side} Calf`, `Bip01 ${side} Foot`, new THREE.Vector3(0, -1, 0.15));
    // Hands at chest height, a forearm's length out: where cards are held to be read, and
    // where a first-person camera at the eyes sees them without looking straight down.
    aim(avatar, `Bip01 ${side} UpperArm`, `Bip01 ${side} Forearm`, new THREE.Vector3(s * 0.1, -0.75, 0.6));
    aimAt(avatar, `Bip01 ${side} Forearm`, `Bip01 ${side} Hand`, neck.clone().add(new THREE.Vector3(s * 0.07, -0.16, 0.34)));
  }
  turn(avatar, "Bip01 Spine1", X, 8);
  turn(avatar, "Bip01 Head", X, 10);
  // Pelvis down onto the chair: the rest pose stands with the pelvis at hip height.
  const pelvis = avatar.bones.get("Bip01 Pelvis");
  if (pelvis) {
    const standing = new THREE.Vector3();
    pelvis.getWorldPosition(standing);
    avatar.root.position.y -= standing.y - avatar.root.position.y - seatHeight - 0.08;
  }
  avatar.root.updateMatrixWorld(true);
}

/**
 * Stands the avatar at ease behind a counter: arms down, hands resting a little forward
 * at counter height, a small nod of attention. Facing +z in root space.
 */
export function poseStanding(avatar: Avatar) {
  avatar.root.updateMatrixWorld(true);
  const neck = new THREE.Vector3();
  avatar.bones.get("Bip01 Neck")?.getWorldPosition(neck);
  avatar.root.worldToLocal(neck);
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    aim(avatar, `Bip01 ${side} UpperArm`, `Bip01 ${side} Forearm`, new THREE.Vector3(s * 0.12, -1, 0.15));
    aimAt(avatar, `Bip01 ${side} Forearm`, `Bip01 ${side} Hand`, neck.clone().add(new THREE.Vector3(s * 0.2, -0.62, 0.28)));
  }
  turn(avatar, "Bip01 Head", X, 6);
  avatar.root.updateMatrixWorld(true);
}

/** Blinks now and then, and lets the eyes rest half-lidded between blinks. */
export function idleFace(avatar: Avatar, t: number) {
  const phase = (t / 1000 + avatar.root.id * 0.37) % 4.2;
  const blink = phase < 0.15 ? Math.sin((phase / 0.15) * Math.PI) : 0;
  avatar.face("EyeBlinkLeft", blink);
  avatar.face("EyeBlinkRight", blink);
}

/**
 * A holder for the hole cards: an unscaled object in root space between the two hands, its
 * +z (card face) turned back toward the player and tilted up to their eyes, so the owner
 * reads the cards and the table sees the backs. Independent of the hand bones' axes.
 */
export function cardAnchor(avatar: Avatar): THREE.Object3D {
  avatar.root.updateMatrixWorld(true);
  const l = new THREE.Vector3();
  const r = new THREE.Vector3();
  avatar.bones.get("Bip01 L Hand")?.getWorldPosition(l);
  avatar.bones.get("Bip01 R Hand")?.getWorldPosition(r);
  const mid = avatar.root.worldToLocal(l.add(r).multiplyScalar(0.5));
  const anchor = new THREE.Object3D();
  anchor.name = "cards";
  anchor.position.copy(mid).add(new THREE.Vector3(0, 0.09, 0.03));
  anchor.rotation.set(-0.55, Math.PI, 0, "YXZ"); // face the player, leaning back toward the eyes
  avatar.root.add(anchor);
  return anchor;
}

/** Where the eyes are, in world space, after posing. */
export function eyePosition(avatar: Avatar): THREE.Vector3 {
  avatar.root.updateMatrixWorld(true);
  const head = avatar.bones.get("Bip01 Head") ?? avatar.bones.get("Bip01 Neck");
  const p = new THREE.Vector3();
  if (head) head.getWorldPosition(p);
  // The head bone sits at the base of the skull; eyes are a little up and forward.
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(avatar.root.quaternion);
  return p.add(new THREE.Vector3(0, 0.08, 0)).addScaledVector(forward, 0.09);
}

/** Collapses the head so the wearer does not see their own face from inside it. */
export function hideOwnHead(avatar: Avatar) {
  avatar.bones.get("Bip01 Head")?.scale.setScalar(0.001);
}
