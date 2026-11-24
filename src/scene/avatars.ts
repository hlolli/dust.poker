import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CARD_H, CARD_W } from "./cards.ts";
import { MODELS, STAFF } from "./models.ts";
import { FELT_TOP, RAIL_RADIUS, RAIL_TOP, SEAT_RADIUS } from "./table.ts";

// The house cast and older Rocketbox characters share Biped bone names and ARKit face shapes.

export interface Avatar {
  root: THREE.Group;
  bones: Map<string, THREE.Bone>;
  /** Joints used for seated hand poses, including the spine for a reach across the rail. */
  seatRest: Map<THREE.Bone, THREE.Quaternion>;
  seatedShoulders?: THREE.Vector3;
  mesh: THREE.SkinnedMesh;
  /** Attach things to a hand here: the palm of the right or left hand. */
  hand(side: "L" | "R"): THREE.Bone;
  /** Set an ARKit blendshape by its short name, e.g. "EyeBlinkLeft", to a weight 0..1. */
  face(name: string, weight: number): void;
  /** Which way the face points, in the head bone's own space: +z of the root in the rest pose. What a look is aimed with. */
  headForward: THREE.Vector3;
}

const loader = new GLTFLoader();
const houseCast = new Set([...MODELS.map((model) => model.url), ...Object.values(STAFF)]);

export async function loadAvatar(url: string): Promise<Avatar> {
  const gltf = await loader.loadAsync(url);
  const root = gltf.scene;
  const bones = new Map<string, THREE.Bone>();
  const seatRest = new Map<THREE.Bone, THREE.Quaternion>();
  let mesh: THREE.SkinnedMesh | undefined;
  root.traverse((o) => {
    // The glTF exporter writes "Bip01 L Thigh" as "Bip01_L_Thigh"; key bones by the Biped name.
    if (o instanceof THREE.Bone) {
      const name = o.name.replace(/_/g, " ");
      bones.set(name, o);
      if (name === "Bip01 Spine" || /^Bip01 [LR] (UpperArm|Forearm|Hand|Finger\d+)$/.test(name)) seatRest.set(o, o.quaternion.clone());
    }
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  cutOut(root);
  if (!mesh) throw new Error(`${url}: no skinned mesh`);
  const m = mesh;
  root.updateMatrixWorld(true);
  // Our poses rotate joints and move or scale the whole character. The shipped
  // rigs fit within 1.6 m of the pelvis even at full reach (avatars.test.ts).
  const hips = bones.get("Bip01 Pelvis");
  const bounds = hips && houseCast.has(url) ? new THREE.Sphere(hips.getWorldPosition(new THREE.Vector3()), 1.6) : null;
  // Body, head, lashes and glasses are separate meshes, each with its own copy of the face
  // shapes: a blink must reach them all, or the lids stay open while the lashes move.
  const faces: { mesh: THREE.SkinnedMesh; index: Map<string, number> }[] = [];
  root.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    sm.frustumCulled = bounds !== null;
    if (bounds) sm.boundingSphere = bounds.clone().applyMatrix4(sm.matrixWorld.clone().invert());
    if (!sm.morphTargetDictionary || !sm.morphTargetInfluences) return;
    const index = new Map<string, number>();
    for (const [key, i] of Object.entries(sm.morphTargetDictionary)) index.set(key.replace(/^AK_\d+_/, ""), i);
    faces.push({ mesh: sm, index });
  });
  // The rest pose faces +z: that direction, held in the head bone's frame, is the face's forward.
  const headForward = new THREE.Vector3(0, 0, 1);
  const head = bones.get("Bip01 Head");
  if (head) headForward.applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion()).invert());

  const bone = (name: string) => {
    const b = bones.get(name);
    if (!b) throw new Error(`${url}: no bone ${name}`);
    return b;
  };
  return {
    root,
    bones,
    seatRest,
    mesh: m,
    hand: (side) => bone(`Bip01 ${side} Hand`),
    face: (name, weight) => {
      for (const f of faces) {
        const i = f.index.get(name);
        if (i !== undefined) f.mesh.morphTargetInfluences![i] = weight;
      }
    },
    headForward,
  };
}

/**
 * Hair strands, lashes and glasses. Rocketbox keeps them on one `_opacity` texture whose alpha
 * says where they are, and scripts/convert-avatar.py exported it as a plain colour (it links
 * alpha only for materials named hair), so they drew as solid grey strips. Cut them out by that
 * alpha here; alpha-to-coverage smooths the cut edge in the multisampled frame. The glasses
 * came out wearing the body texture: they take the opacity texture too, where their frames are.
 * ponytail: fixed at load; a re-export would carry it in the files.
 */
function cutOut(root: THREE.Object3D) {
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if ((o as THREE.Mesh).isMesh && mat && !Array.isArray(mat)) materials.set(mat.name, mat);
  });
  for (const [name, mat] of materials) {
    if (name.endsWith("_opacity")) {
      mat.alphaTest = 0.35;
      mat.alphaToCoverage = true;
      mat.transparent = false; // a cutout, not blended: blended strands sort against each other and flicker
      mat.depthWrite = true;
      mat.roughness = Math.max(mat.roughness, 0.75); // hair is matte; glossier, it catches the room as a grey sheen
    }
    if (name.endsWith("_glasses")) {
      const opacity = materials.get(name.replace(/_glasses$/, "_opacity"));
      if (opacity?.map) mat.map = opacity.map;
      mat.alphaTest = 0.35;
      mat.alphaToCoverage = true;
    }
  }
}

/** Rotates a bone about an axis given in the avatar root's space, on top of its current pose. */
export function turn(avatar: Avatar, boneName: string, axis: THREE.Vector3, degrees: number) {
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
  const bw = new THREE.Vector3();
  const cw = new THREE.Vector3();
  b.getWorldPosition(bw);
  c.getWorldPosition(cw);
  const current = cw.sub(bw).normalize();
  const rootWorld = new THREE.Quaternion();
  avatar.root.getWorldQuaternion(rootWorld);
  const desired = dirRoot.clone().normalize().applyQuaternion(rootWorld);
  rotateToward(b, current, desired);
}

/** Like `aim`, toward a point given in root space. */
function aimAt(avatar: Avatar, boneName: string, childName: string, targetRoot: THREE.Vector3) {
  const b = avatar.bones.get(boneName);
  if (!b) return;
  const bw = new THREE.Vector3();
  b.getWorldPosition(bw);
  const bRoot = avatar.root.worldToLocal(bw);
  aim(avatar, boneName, childName, targetRoot.clone().sub(bRoot));
}

/**
 * Puts a hand at `target` (root space) by bending the arm at the elbow: a two-bone reach, the
 * elbow found from the arm's own bone lengths and pushed toward `pole` (a root-space direction:
 * down and out, for a relaxed arm). Aiming the upper arm and forearm at fixed directions lands
 * the hand wherever that rig's arm lengths take it; this lands it on the target on any rig.
 */
function reach(avatar: Avatar, side: "L" | "R", target: THREE.Vector3, pole: THREE.Vector3) {
  const upper = avatar.bones.get(`Bip01 ${side} UpperArm`);
  const fore = avatar.bones.get(`Bip01 ${side} Forearm`);
  const hand = avatar.bones.get(`Bip01 ${side} Hand`);
  if (!upper || !fore || !hand) return;
  const local = (b: THREE.Bone) => avatar.root.worldToLocal(b.getWorldPosition(new THREE.Vector3()));
  const shoulder = local(upper);
  const a = shoulder.distanceTo(local(fore));
  const b = local(fore).distanceTo(local(hand));
  const toTarget = target.clone().sub(shoulder);
  const d = THREE.MathUtils.clamp(toTarget.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const dir = toTarget.normalize();
  // Along the shoulder-to-hand line by x, then out toward the pole by h: the elbow.
  const x = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const out = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  const elbow = shoulder.clone().addScaledVector(dir, x).addScaledVector(out, h);
  aim(avatar, `Bip01 ${side} UpperArm`, `Bip01 ${side} Forearm`, elbow.sub(shoulder));
  aimAt(avatar, `Bip01 ${side} Forearm`, `Bip01 ${side} Hand`, target);
}

/**
 * Between the shoulders, in root space: what the hands' places are measured from. Not the neck
 * bone, which the Biped rig puts at the shoulders and MakeHuman's halfway up the neck, 9 cm higher.
 */
function shoulders(avatar: Avatar): THREE.Vector3 {
  const mid = new THREE.Vector3();
  for (const side of ["L", "R"]) {
    const b = avatar.bones.get(`Bip01 ${side} UpperArm`) ?? avatar.bones.get("Bip01 Neck");
    if (b) mid.add(avatar.root.worldToLocal(b.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5));
  }
  return mid;
}

/**
 * A place before a seated avatar, in root space: `out` metres from the seat toward the table's
 * middle, `across` to the avatar's left, at world height `y`. Table heights are the room's, not
 * the body's, so a hand laid on the rail stays on it whatever the character's size.
 */
function beforeSeat(avatar: Avatar, out: number, across: number, y: number): THREE.Vector3 {
  const q = avatar.root.getWorldQuaternion(new THREE.Quaternion());
  const at = avatar.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(across, 0, out).applyQuaternion(q)).setY(y);
  return avatar.root.worldToLocal(at);
}

/** Where a relaxed seated or standing elbow goes: down, out to its side, a little back. */
const elbowPole = (s: number) => new THREE.Vector3(s * 0.6, -1, -0.25);

/** How far to lean at the waist to reach a wrist target without stretching the arm. */
function leanForWrist(a: Avatar, side: "L" | "R", target: THREE.Vector3) {
  const upper = a.bones.get(`Bip01 ${side} UpperArm`), fore = a.bones.get(`Bip01 ${side} Forearm`), spine = a.bones.get("Bip01 Spine");
  if (!upper || !fore || !spine) return 0;
  const local = (b: THREE.Bone) => a.root.worldToLocal(b.getWorldPosition(new THREE.Vector3()));
  const shoulder = local(upper), elbow = local(fore), pivot = local(spine);
  const length = shoulder.distanceTo(elbow) + elbow.distanceTo(local(a.hand(side))) - 0.004;
  if (shoulder.distanceTo(target) <= length) return 0;
  const offset = shoulder.sub(pivot), to = target.clone().sub(pivot);
  let low = 0, high = 42;
  for (let i = 0; i < 7; i++) {
    const angle = (low + high) * 0.5;
    if (offset.clone().applyAxisAngle(X, THREE.MathUtils.degToRad(angle)).distanceTo(to) > length) low = angle;
    else high = angle;
  }
  return high;
}

type WristTarget = { side: "L" | "R"; target: THREE.Vector3; rotation: THREE.Quaternion };

function reachWrists(a: Avatar, wrists: WristTarget[]) {
  if (!wrists.length) return;
  const lean = Math.max(...wrists.map(w => leanForWrist(a, w.side, w.target)));
  turn(a, "Bip01 Spine", X, lean);
  for (const { side, target, rotation } of wrists) {
    reach(a, side, target, elbowPole(side === "L" ? 1 : -1));
    const wrist = a.hand(side);
    wrist.quaternion.copy(wrist.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
  }
}

/** Move a wrist past the cushion on the way between the felt and a folded arm or lap. */
export function passRail(a: Avatar, side: "L" | "R", start: THREE.Vector3, end: THREE.Vector3, t: number) {
  // Lift a tucked hand on the player's side before reaching over the rail.
  const raised = (at: THREE.Vector3) => {
    const control = at.clone();
    control.y = Math.max(control.y, RAIL_TOP + 0.25);
    if (Math.hypot(at.x, at.z) > RAIL_RADIUS) control.addScaledVector(new THREE.Vector3(at.x, 0, at.z).normalize(), 0.26);
    return control;
  };
  const target = new THREE.CubicBezierCurve3(start, raised(start), raised(end), end).getPoint(t);
  const wrist = a.hand(side);
  const rotation = wrist.getWorldQuaternion(new THREE.Quaternion());
  const upper = a.bones.get(`Bip01 ${side} UpperArm`), fore = a.bones.get(`Bip01 ${side} Forearm`);
  if (!upper || !fore) return;
  const elbow = a.root.worldToLocal(fore.getWorldPosition(new THREE.Vector3()));
  const shoulder = a.root.worldToLocal(upper.getWorldPosition(new THREE.Vector3()));
  reach(a, side, a.root.worldToLocal(target), elbow.sub(shoulder));
  wrist.quaternion.copy(wrist.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
}

/** Seat the avatar facing +z, with thighs forward, shins down and hands on the rail. */
export function poseSeated(avatar: Avatar, seatHeight = 0.5) {
  avatar.root.updateMatrixWorld(true);
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1; // facing +z, the character's left is +x
    aim(avatar, `Bip01 ${side} Thigh`, `Bip01 ${side} Calf`, new THREE.Vector3(s * 0.1, -0.12, 1));
    aim(avatar, `Bip01 ${side} Calf`, `Bip01 ${side} Foot`, new THREE.Vector3(0, -1, 0.15));
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
  avatar.seatedShoulders = shoulders(avatar);
  poseHands(avatar, "rail");
  avatar.root.updateMatrixWorld(true);
}

/**
 * What a seated player's arms are doing. `hold`: the cards up in both hands before the chest,
 * read. `rail`: hands apart on the rail. `crossed`: arms folded. `cover`: the right hand resting
 * on cards laid on the felt, the left on the rail. `lap`: hands in the lap, under the table.
 */
export type ArmPose = "hold" | "rail" | "crossed" | "cover" | "lap";

/**
 * Pose the arms from their seated rest rotations. For a cover, the right middle finger
 * reaches for the card at `cards` in world space.
 */
export function poseHands(avatar: Avatar, pose: Exclude<ArmPose, "hold">, cards?: THREE.Vector3) {
  for (const [bone, rest] of avatar.seatRest) bone.quaternion.copy(rest);
  const chest = shoulders(avatar);
  const wrists: WristTarget[] = [];
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    if (pose === "lap") {
      reach(avatar, side, chest.clone().add(new THREE.Vector3(s * 0.12, -0.5, 0.26)), elbowPole(s));
      curl(avatar, side, 30);
      continue;
    }
    if (pose === "crossed") {
      // Forearms level across the chest, the right one over the left, the wrists just past the
      // middle so the curled fingers reach the other arm; the elbows out and down. Close in, so
      // a short arm reaches too: out of reach, the arm goes straight and the arms make an X.
      const wrist = side === "L" ? new THREE.Vector3(-0.05, -0.21, 0.2) : new THREE.Vector3(0.05, -0.17, 0.25);
      reach(avatar, side, chest.clone().add(wrist), new THREE.Vector3(s, -0.7, 0.15));
      curl(avatar, side, 55);
      continue;
    }
    const covering = pose === "cover" && side === "R" && cards;
    aim(avatar, `Bip01 ${side} Hand`, `Bip01 ${side} Finger2`, new THREE.Vector3(-s * (covering ? 0.75 : 0.25), covering ? -0.55 : 0.20, 1));
    palmUp(avatar, side, -1);
    curl(avatar, side, covering ? 3 : 8);
    if (covering) {
      // Open the thumb alongside the fingers. A relaxed thumb hangs below the
      // palm and would pass through the cushion while the middle finger covers the card.
      const thumb = avatar.bones.get(`Bip01 ${side} Finger0`);
      const tip = avatar.bones.get(`Bip01 ${side} Finger02`);
      const p = palm(avatar, side);
      if (thumb && tip && p) {
        const from = fingerPad(tip).sub(thumb.getWorldPosition(new THREE.Vector3())).normalize();
        const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(p.quaternion);
        rotateToward(thumb, from, from.clone().addScaledVector(normal, -from.dot(normal)).normalize());
      }
    }
    const wrist = avatar.hand(side);
    const tip = avatar.bones.get(`Bip01 ${side} Finger22`);
    const target = beforeSeat(avatar, SEAT_RADIUS - RAIL_RADIUS + 0.028, s * 0.17, RAIL_TOP + 0.020);
    if (covering && tip) {
      const contact = covering.clone().add(new THREE.Vector3(0, 0.009, 0.025).applyQuaternion(avatar.root.getWorldQuaternion(new THREE.Quaternion())));
      target.copy(avatar.root.worldToLocal(wrist.getWorldPosition(new THREE.Vector3()).add(contact.sub(fingerPad(tip)))));
    }
    wrists.push({ side, target, rotation: wrist.getWorldQuaternion(new THREE.Quaternion()) });
  }
  reachWrists(avatar, wrists);
}

/**
 * The palm of a hand, in world space: a point between the wrist and the knuckles, lifted off
 * the skin, and a frame whose y is the palm's normal (out of the palm), z runs toward the
 * fingers and x across the knuckles. Found from the finger bones, so it holds on any rig that has them.
 */
export function palm(avatar: Avatar, side: "L" | "R"): { position: THREE.Vector3; quaternion: THREE.Quaternion } | null {
  const bone = (n: string) => avatar.bones.get(`Bip01 ${side} ${n}`);
  const [hand, index, middle, pinky] = [bone("Hand"), bone("Finger1"), bone("Finger2"), bone("Finger4")];
  if (!hand || !index || !middle || !pinky) return null;
  const at = (b: THREE.Bone) => b.getWorldPosition(new THREE.Vector3());
  const wrist = at(hand);
  const along = at(middle).sub(wrist).normalize();
  const across = at(pinky).sub(at(index));
  across.addScaledVector(along, -across.dot(along)).normalize();
  // The palm faces away from the back of the hand: which way that is depends on the hand.
  const normal = new THREE.Vector3().crossVectors(along, across).multiplyScalar(side === "R" ? 1 : -1);
  const x = new THREE.Vector3().crossVectors(normal, along);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, normal, along));
  const position = wrist.lerp(at(middle), 0.55).addScaledVector(normal, 0.018);
  return { position, quaternion };
}

/**
 * Curls the fingers toward the palm by `degrees` at each knuckle, the thumb a third as much;
 * from the fingers' rest pose each time, so calling it again does not curl them further.
 */
export function curl(avatar: Avatar, side: "L" | "R", degrees: number) {
  const fingers: THREE.Bone[] = [];
  for (let n = 0; n <= 4; n++) for (const k of ["", "1", "2"]) {
    const b = avatar.bones.get(`Bip01 ${side} Finger${n}${k}`);
    if (b) fingers.push(b);
  }
  for (const b of fingers) b.quaternion.copy(avatar.seatRest.get(b)!);
  const p = palm(avatar, side);
  if (!p) return;
  // Toward the palm: about the axis across the knuckles, turning the fingers' run toward the palm's normal.
  const axis = new THREE.Vector3(-1, 0, 0).applyQuaternion(p.quaternion);
  for (const b of fingers) {
    if (!b.parent) continue;
    const thumb = b.name.replace(/_/g, " ").includes("Finger0");
    const parent = b.parent.getWorldQuaternion(new THREE.Quaternion());
    const q = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(thumb ? degrees / 3 : degrees));
    b.quaternion.premultiply(parent.clone().invert().multiply(q).multiply(parent));
  }
}

/** Midway along the pad of the distal phalanx on the exported Biped fingers. */
function fingerPad(tip: THREE.Bone) {
  return tip.localToWorld(new THREE.Vector3(0, tip.position.length() * 0.7, 0));
}

function rotateToward(bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3) {
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.premultiply(parent.clone().invert().multiply(new THREE.Quaternion().setFromUnitVectors(from, to)).multiply(parent));
}

// The pinch is rigid in wrist space. Measure it once on each hand so a longer
// thumb or a shorter index finger changes where the wrist goes, not the card.
function measureGrip(a: Avatar, side: "L" | "R") {
  const wrist = a.hand(side);
  const thumb = a.bones.get(`Bip01 ${side} Finger0`);
  const thumbTip = a.bones.get(`Bip01 ${side} Finger02`);
  const indexTip = a.bones.get(`Bip01 ${side} Finger12`);
  const frame = palm(a, side);
  if (!thumb?.parent || !thumbTip || !indexTip || !frame) return;
  curl(a, side, 32);
  const index = fingerPad(indexTip);
  const origin = thumb.getWorldPosition(new THREE.Vector3());
  const from = fingerPad(thumbTip).sub(origin).normalize();
  const across = new THREE.Vector3(side === "L" ? 1 : -1, 0, 0).applyQuaternion(frame.quaternion);
  const to = index.clone().addScaledVector(across, 0.012).sub(origin).normalize();
  rotateToward(thumb, from, to);

  const finger = wrist.worldToLocal(index);
  const opposed = wrist.worldToLocal(fingerPad(thumbTip));
  const point = finger.clone().lerp(opposed, 0.5);
  const normal = opposed.sub(finger).normalize();
  const fingers = [...a.seatRest.keys()].filter(b => b.name.replace(/_/g, " ").startsWith(`Bip01 ${side} Finger`));
  return { point, inverseFrame: gripFrame(normal, point).invert(), fingers: fingers.map(b => ({ bone: b, rotation: b.quaternion.clone() })) };
}

function gripFrame(normal: THREE.Vector3, along: THREE.Vector3) {
  const x = new THREE.Vector3().crossVectors(along, normal).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, normal.clone().cross(x), normal));
}

const grips = new WeakMap<THREE.Bone, ReturnType<typeof measureGrip>>();

/** Put opposing finger pads on the two surfaces at the outside edge of each card. */
export function holdCards(avatar: Avatar, cards: readonly THREE.Object3D[]) {
  for (const [bone, rest] of avatar.seatRest) bone.quaternion.copy(rest);
  const wrists: WristTarget[] = [];
  for (const [k, side] of (["L", "R"] as const).entries()) {
    const card = cards[k];
    if (!card) continue;
    const s = side === "L" ? 1 : -1;
    const wrist = avatar.hand(side);
    if (!grips.has(wrist)) grips.set(wrist, measureGrip(avatar, side));
    const grip = grips.get(wrist);
    if (!grip || !wrist.parent) continue;
    for (const { bone, rotation } of grip.fingers) bone.quaternion.copy(rotation);
    const contact = card.localToWorld(new THREE.Vector3(-s * (CARD_W / 2 - 0.006), -CARD_H * 0.23, 0));
    const facing = avatar.root.getWorldQuaternion(new THREE.Quaternion());
    const low = 1 - THREE.MathUtils.smoothstep(contact.y, FELT_TOP + 0.035, RAIL_TOP + 0.065);
    // Slip the pads around the edge as the card meets the felt. Pitch the
    // wrist up over the cushion so neither the thumb nor the palm goes through it.
    const normal = card.getWorldDirection(new THREE.Vector3()).lerp(new THREE.Vector3(-s, 0, 0).applyQuaternion(facing), low).normalize();
    const along = new THREE.Vector3(-s * 0.8, 0.45 - 2.8 * low, 1).applyQuaternion(facing);
    contact.y = Math.max(contact.y, FELT_TOP + 0.014);
    const rotation = gripFrame(normal, along).multiply(grip.inverseFrame);
    const offset = grip.point.clone().multiply(wrist.getWorldScale(new THREE.Vector3())).applyQuaternion(rotation);
    const target = avatar.root.worldToLocal(contact.sub(offset));
    wrists.push({ side, rotation, target });
  }
  reachWrists(avatar, wrists);
}

/** Turns a hand about its own length until its palm faces up (as for holding a deck) or, with `way` -1, down (laid on the rail). */
export function palmUp(avatar: Avatar, side: "L" | "R", way = 1) {
  const p = palm(avatar, side);
  const hand = avatar.bones.get(`Bip01 ${side} Hand`);
  if (!p || !hand?.parent) return;
  const along = new THREE.Vector3(0, 0, 1).applyQuaternion(p.quaternion);
  const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(p.quaternion);
  const up = new THREE.Vector3(0, way, 0).addScaledVector(along, -along.y * way).normalize();
  const angle = Math.atan2(new THREE.Vector3().crossVectors(normal, up).dot(along), normal.dot(up));
  // The twist, as a world rotation, moved into the hand's parent space.
  const parent = hand.parent.getWorldQuaternion(new THREE.Quaternion());
  const twist = new THREE.Quaternion().setFromAxisAngle(along, angle);
  hand.quaternion.premultiply(parent.clone().invert().multiply(twist).multiply(parent));
}

/** The dealer at the rail: the deck in the left hand, palm up, the right hand over it, ready to deal. */
export function poseDealer(avatar: Avatar) {
  poseStanding(avatar);
  const chest = shoulders(avatar);
  reach(avatar, "L", chest.clone().add(new THREE.Vector3(0.1, -0.5, 0.3)), new THREE.Vector3(0.6, -0.8, -0.3));
  palmUp(avatar, "L");
  curl(avatar, "L", 12); // a flat palm under the deck
  dealerReach(avatar, null);
}

/**
 * The dealer's right hand pushing toward `target` (world space); with null, `up` of the way
 * from hanging at his side (0) to over the deck, dealing (1). The middle of the table is out of
 * any arm's reach; the arm then goes out straight toward it, which reads as the push or the
 * sweep of an open hand.
 */
export function dealerReach(avatar: Avatar, target: THREE.Vector3 | null, up = 0) {
  const chest = shoulders(avatar);
  const side = chest.clone().add(new THREE.Vector3(-0.2, -0.6, 0.08));
  const deck = chest.clone().add(new THREE.Vector3(-0.06, -0.44, 0.34));
  const at = target ? avatar.root.worldToLocal(target.clone()) : side.lerp(deck, up);
  const pole = new THREE.Vector3(-0.6, -0.8, -0.3).lerp(new THREE.Vector3(-0.5, -0.4, -1), target ? 0 : 1 - up);
  reach(avatar, "R", at, pole);
  curl(avatar, "R", target ? 10 : 25 + up * 10); // open to push, loose at rest
}

/**
 * Both hands of a seated winner drawing chips at `at` (world space) home: each hand to one side
 * of the pile, fingers bent round it. Out of reach, the arms go out toward it.
 */
export function drawIn(avatar: Avatar, at: THREE.Vector3) {
  avatar.root.updateMatrixWorld(true);
  const local = avatar.root.worldToLocal(at.clone().add(new THREE.Vector3(0, 0.03, 0)));
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    reach(avatar, side, local.clone().add(new THREE.Vector3(s * 0.08, 0, -0.02)), elbowPole(s));
    curl(avatar, side, 40);
  }
}

/**
 * A stride of a walk, by `phase` in radians: the legs swing past each other, the trailing
 * knee bends, the arms swing the other way. Facing +z in root space; call every frame while
 * walking, then pose the avatar however it should stand or sit.
 */
export function poseWalking(avatar: Avatar, phase: number) {
  avatar.root.updateMatrixWorld(true);
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    const swing = Math.sin(phase + (s > 0 ? 0 : Math.PI));
    aim(avatar, `Bip01 ${side} Thigh`, `Bip01 ${side} Calf`, new THREE.Vector3(s * 0.05, -1, swing * 0.42));
    aim(avatar, `Bip01 ${side} Calf`, `Bip01 ${side} Foot`, new THREE.Vector3(0, -1, swing < 0 ? swing * 0.7 : 0.05)); // the trailing leg folds
    aim(avatar, `Bip01 ${side} UpperArm`, `Bip01 ${side} Forearm`, new THREE.Vector3(s * 0.12, -1, -swing * 0.3));
    aim(avatar, `Bip01 ${side} Forearm`, `Bip01 ${side} Hand`, new THREE.Vector3(s * 0.05, -1, 0.25 - swing * 0.25));
  }
  avatar.root.updateMatrixWorld(true);
}

/**
 * Stands the avatar at ease behind a counter: arms down, hands resting a little forward
 * at counter height, a small nod of attention. Facing +z in root space.
 */
export function poseStanding(avatar: Avatar) {
  avatar.root.updateMatrixWorld(true);
  const chest = shoulders(avatar);
  for (const side of ["L", "R"] as const) {
    const s = side === "L" ? 1 : -1;
    reach(avatar, side, chest.clone().add(new THREE.Vector3(s * 0.2, -0.62, 0.28)), new THREE.Vector3(s * 0.5, -0.4, -1));
    curl(avatar, side, 25);
  }
  turn(avatar, "Bip01 Head", X, 6);
  avatar.root.updateMatrixWorld(true);
}

/**
 * A holder for the hole cards: an unscaled object in root space between the two hands, its
 * +z (card face) turned back toward the player and tilted up to their eyes, so the owner
 * reads the cards and the table sees the backs. Independent of the hand bones' axes.
 */
export function cardAnchor(avatar: Avatar, lift = 0): THREE.Object3D {
  const anchor = new THREE.Object3D();
  anchor.name = "cards";
  anchor.position.copy(avatar.seatedShoulders ?? shoulders(avatar)).add(new THREE.Vector3(0, -0.09 + lift * 1.8, 0.34 + lift));
  const at = avatar.root.localToWorld(anchor.position);
  at.y = Math.max(at.y, RAIL_TOP + 0.16);
  avatar.root.worldToLocal(at);
  anchor.scale.divide(avatar.root.getWorldScale(new THREE.Vector3()));
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

/** Hides or shows the wearer's own head: hidden while the camera is in their eyes, shown when it leaves. */
export function showOwnHead(avatar: Avatar, visible: boolean) {
  // Our characters' heads are meshes of their own (scripts/make-character.py cuts them off),
  // with the hair, brows, lashes and eyes: hidden whole. Otherwise the head bone is collapsed,
  // which draws the neck into the camera but is all an older character allows.
  let meshes = 0;
  avatar.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const material = m.material.name;
    if (m.name.endsWith("_head") || material.endsWith("_opacity") || material.endsWith("_eyes")) {
      m.visible = visible;
      meshes++;
    }
  });
  if (!meshes) avatar.bones.get("Bip01 Head")?.scale.setScalar(visible ? 1 : 0.001);
}
