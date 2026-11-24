import * as THREE from "three";
import { type Avatar, turn } from "./avatars.ts";

/**
 * What keeps a character from standing like a statue between the moments the game poses them:
 * the eyes lead and the head follows to whatever holds their attention (whoever is to act, the
 * dealer's hands, their own cards, a neighbour), breathing, a slow shift of weight, blinks at
 * uneven intervals, small passing expressions, and a smile or a frown when a deal ends.
 *
 * All of it goes on top of the current pose and comes off again after the frame is drawn
 * (`apply`, then `restore`), so the poses the deal sets (seated, holding cards, walking) are
 * never disturbed and nothing drifts. Held cards hang from the body's root, not the hands, so
 * a player holding them sits still below the neck; the head and face move freely.
 */

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const DEG = 180 / Math.PI;

/** Where a character may look this frame, in world space. */
export type Attention = {
  /** What the table is about now: the seat to act, the dealer's hands, the winner. */
  focus: THREE.Vector3 | null;
  /** Everyone else's head, for a glance. */
  others: THREE.Vector3[];
  /** It is this character's own turn: they look at their cards and the pot, thinking. */
  deciding: boolean;
  /** A player resting between actions can look around the room. */
  idle?: boolean;
  /** The fingers are in contact with a card or the table, or moving into that pose. */
  handsPlanted?: boolean;
};

type Expression = { shapes: [string, number][]; start: number; rise: number; hold: number; fall: number };

/** Passing looks: a weight per face shape, held a moment. */
const EXPRESSIONS: [string, number][][] = [
  [["MouthSmileLeft", 0.22], ["MouthSmileRight", 0.22]],
  [["MouthPressLeft", 0.35], ["MouthPressRight", 0.35]],
  [["BrowInnerUp", 0.3]],
  [["MouthSmileLeft", 0.32], ["CheekSquintLeft", 0.12]],
  [["EyeSquintLeft", 0.22], ["EyeSquintRight", 0.22], ["BrowDownLeft", 0.12], ["BrowDownRight", 0.12]],
  [["MouthRollLower", 0.25]],
  [["JawLeft", 0.12], ["MouthLeft", 0.15]],
];
const WIN: [string, number][] = [["MouthSmileLeft", 0.75], ["MouthSmileRight", 0.75], ["CheekSquintLeft", 0.35], ["CheekSquintRight", 0.35], ["BrowOuterUpLeft", 0.2], ["BrowOuterUpRight", 0.2]];
const LOSE: [string, number][] = [["MouthFrownLeft", 0.4], ["MouthFrownRight", 0.4], ["MouthPressLeft", 0.3], ["MouthPressRight", 0.3], ["BrowDownLeft", 0.25], ["BrowDownRight", 0.25]];
/** Every shape this module writes, so each frame sets them all and none is left behind. */
const SHAPES = [
  ...new Set([
    ...EXPRESSIONS.flat().map(([n]) => n),
    ...WIN.map(([n]) => n),
    ...LOSE.map(([n]) => n),
    "EyeBlinkLeft", "EyeBlinkRight", "EyeLookInLeft", "EyeLookInRight", "EyeLookOutLeft", "EyeLookOutRight", "EyeLookUpLeft", "EyeLookUpRight", "EyeLookDownLeft", "EyeLookDownRight",
  ]),
];

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const damp = (from: number, to: number, rate: number, dt: number) => to + (from - to) * Math.exp(-rate * dt);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Life {
  private readonly rnd: () => number;
  private readonly bones: THREE.Bone[];
  private readonly saved: THREE.Quaternion[];
  /** Per character: breath rate and the phases of the slow sway, so no two move in step. */
  private readonly breath: number;
  private readonly sway: number[];
  // The look: where the eyes are aimed, how far the head has followed (radians, relative to the pose).
  private lookAt: THREE.Vector3 | null = null;
  private nextLook = 0;
  private saccade = { yaw: 0, pitch: 0, next: 0 };
  private head = { yaw: 0, pitch: 0 };
  /** How much of the look's turn the chest takes: some at rest, none while holding cards. */
  private torso = 0;
  /** How much the body breathes and sways: none while holding cards, or the hands would part from them. */
  private body = 1;
  private eyes = { yaw: 0, pitch: 0 };
  private blink = { next: 0, start: -1, again: false };
  private expression: Expression | null = null;
  private nextExpression = 0;
  private mood: Expression | null = null;
  private last = 0;

  private readonly standing: boolean;
  /** Whether the head and eyes move: not for your own character, whose head the camera is. */
  private readonly looks: boolean;

  constructor(
    private readonly avatar: Avatar,
    o: { seed: number; standing?: boolean; head?: boolean },
  ) {
    this.standing = o.standing ?? false;
    this.looks = o.head ?? true;
    let seed = (o.seed + 1) * 2654435761;
    this.rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    const names = ["Bip01 Pelvis", "Bip01 Spine", "Bip01 Spine1", "Bip01 Spine2", "Bip01 Neck", "Bip01 Head", "Bip01 L Clavicle", "Bip01 R Clavicle"];
    this.bones = names.map((n) => avatar.bones.get(n)).filter((b): b is THREE.Bone => !!b);
    this.saved = this.bones.map(() => new THREE.Quaternion());
    this.breath = 0.2 + this.rnd() * 0.07; // 12 to 16 breaths a minute
    this.sway = [0, 1, 2, 3].map(() => this.rnd() * Math.PI * 2);
    this.blink.next = this.rnd() * 3000;
    this.nextExpression = 4000 + this.rnd() * 8000;
  }

  /** A smile for a win, a frown for a loss, for a few seconds. */
  react(result: "win" | "lose", now: number) {
    this.mood = { shapes: result === "win" ? WIN : LOSE, start: now + 300 + this.rnd() * 500, rise: 400, hold: result === "win" ? 3500 : 2200, fall: 900 };
    this.nextLook = 0; // and look up from the cards
  }

  /** Puts this frame's movement on top of the pose. Call before drawing; `restore` after. */
  apply(now: number, attention: Attention) {
    const dt = Math.min(0.1, this.last ? (now - this.last) / 1000 : 0);
    this.last = now;
    const a = this.avatar;
    this.bones.forEach((b, i) => this.saved[i]!.copy(b.quaternion));
    const t = now / 1000;

    // Your own body stays still: the camera is in it, and your hands are in view. Seated players
    // go still while they hold their cards, which hang from the body's root, not the hands.
    this.body = this.looks && (this.standing || (attention.idle && !attention.handsPlanted)) ? damp(this.body, 1, 3, dt) : 0;
    // Breathing: the chest rises and opens a little, the shoulders lift with it when standing.
    const breath = Math.sin(t * this.breath * Math.PI * 2) * this.body;
    turn(a, "Bip01 Spine2", X, -0.7 * breath);
    if (this.standing) {
      turn(a, "Bip01 L Clavicle", Z, 0.9 * (breath + 1) * 0.5);
      turn(a, "Bip01 R Clavicle", Z, -0.9 * (breath + 1) * 0.5);
    }
    // The weight shifts slowly: two slow waves each for lean and twist, a different pair per person.
    const [p0, p1, p2, p3] = this.sway as [number, number, number, number];
    const lean = (Math.sin(t * 0.21 + p0) * 0.6 + Math.sin(t * 0.083 + p1) * 0.4) * this.body;
    const twist = (Math.sin(t * 0.17 + p2) * 0.6 + Math.sin(t * 0.061 + p3) * 0.4) * this.body;
    if (this.standing) {
      turn(a, "Bip01 Pelvis", Z, 1.6 * lean); // onto one foot, then the other
      turn(a, "Bip01 Spine1", Z, -1.1 * lean);
      turn(a, "Bip01 Spine", Y, 2 * twist);
    } else {
      turn(a, "Bip01 Spine", Z, 0.8 * lean);
      turn(a, "Bip01 Spine", Y, 1.2 * twist);
    }

    if (this.looks) this.look(now, dt, attention);
    this.face(now);
  }

  /** Takes this frame's movement off again, back to the pose alone. */
  restore() {
    this.bones.forEach((b, i) => b.quaternion.copy(this.saved[i]!));
  }

  private look(now: number, dt: number, at: Attention) {
    const a = this.avatar;
    const head = a.bones.get("Bip01 Head");
    if (!head) return;
    if (now >= this.nextLook) this.chooseLook(now, at);
    // Where the face points now, and where it should, both in the character's own space.
    const rootQ = a.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const facing = a.headForward.clone().applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(rootQ);
    let yaw = 0;
    let pitch = 0;
    if (this.lookAt) {
      const from = head.getWorldPosition(new THREE.Vector3());
      const to = this.lookAt.clone().sub(from).applyQuaternion(rootQ).normalize();
      const reach = at.idle ? 1.5 : 1.1; // with the shoulders turning too, a look can go further round
      yaw = THREE.MathUtils.clamp(wrap(Math.atan2(to.x, to.z) - Math.atan2(facing.x, facing.z)), -reach, reach);
      pitch = THREE.MathUtils.clamp(Math.asin(to.y) - Math.asin(THREE.MathUtils.clamp(facing.y, -1, 1)), -0.5, 0.45);
    }
    // Small jumps of the eyes around what they look at.
    if (now >= this.saccade.next) this.saccade = { yaw: (this.rnd() - 0.5) * 0.06, pitch: (this.rnd() - 0.5) * 0.04, next: now + 300 + this.rnd() * 1200 };
    // The eyes get there at once; the head follows over half a second, and never all the way.
    this.head.yaw = damp(this.head.yaw, yaw * 0.85, 4.5, dt);
    this.head.pitch = damp(this.head.pitch, pitch * 0.7, 4, dt);
    this.eyes.yaw = damp(this.eyes.yaw, yaw - this.head.yaw + this.saccade.yaw, 30, dt);
    this.eyes.pitch = damp(this.eyes.pitch, pitch - this.head.pitch + this.saccade.pitch, 30, dt);
    // The neck and head share the turn. The chest can follow when the hands are free.
    this.torso = at.idle && !at.handsPlanted ? damp(this.torso, 0.3, 1.5, dt) : 0;
    turn(a, "Bip01 Spine1", Y, this.head.yaw * this.torso * DEG);
    const rest = 1 - this.torso;
    const neck = a.bones.get("Bip01 Neck");
    // The house cast's clavicles are siblings of the neck. Only older rigs
    // with clavicles parented to the neck need to undo its turn.
    const collars = ["Bip01 L Clavicle", "Bip01 R Clavicle"].map((n) => a.bones.get(n)).filter((b): b is THREE.Bone => !!b && b.parent === neck);
    const held = collars.map((c) => c.getWorldQuaternion(new THREE.Quaternion()));
    turn(a, "Bip01 Neck", Y, this.head.yaw * 0.4 * rest * DEG);
    turn(a, "Bip01 Head", Y, this.head.yaw * 0.6 * rest * DEG);
    const side = new THREE.Vector3(Math.sin(this.head.yaw), 0, Math.cos(this.head.yaw)).cross(Y);
    turn(a, "Bip01 Neck", side, this.head.pitch * 0.3 * DEG);
    turn(a, "Bip01 Head", side, this.head.pitch * 0.7 * DEG);
    if (collars.length && neck?.parent) {
      const neckWorld = neck.parent.getWorldQuaternion(new THREE.Quaternion()).multiply(neck.quaternion);
      collars.forEach((c, i) => c.quaternion.copy(neckWorld.clone().invert().multiply(held[i]!)));
    }
  }

  /** The next thing to look at, and for how long. */
  private chooseLook(now: number, at: Attention) {
    const a = this.avatar;
    const head = a.bones.get("Bip01 Head")!;
    const from = head.getWorldPosition(new THREE.Vector3());
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(a.root.getWorldQuaternion(new THREE.Quaternion()));
    const cards = from.clone().addScaledVector(forward, 0.35).add(new THREE.Vector3(0, -0.4, 0));
    const middle = new THREE.Vector3(0, 0.8, 0);
    const r = this.rnd();
    const neighbour = () => at.others[Math.floor(this.rnd() * at.others.length)]!;
    if (at.deciding) this.lookAt = r < 0.6 ? cards : r < 0.85 ? middle : at.focus;
    else if (at.idle) {
      // Out of the hand: an eye on the table now and then, but mostly the room and the others.
      if (r < 0.3 && at.focus) this.lookAt = at.focus;
      else if (r < 0.6 && at.others.length) this.lookAt = neighbour();
      else this.lookAt = this.away(from);
      this.nextLook = now + 1200 + this.rnd() * 3000;
      return;
    } else if (r < 0.55 && at.focus) this.lookAt = at.focus;
    else if (r < 0.75) this.lookAt = this.standing ? middle : cards;
    else if (r < 0.92 && at.others.length) this.lookAt = neighbour();
    else this.lookAt = this.away(from);
    this.nextLook = now + (at.deciding ? 900 : 1500) + this.rnd() * 3500;
  }

  /** Somewhere across the room, a little above eye level, as far round as a turned head goes. */
  private away(from: THREE.Vector3): THREE.Vector3 {
    const side = (this.rnd() - 0.5) * 3;
    const dir = new THREE.Vector3(Math.sin(side), 0.05 + this.rnd() * 0.3, Math.cos(side));
    return from.clone().add(dir.applyQuaternion(this.avatar.root.getWorldQuaternion(new THREE.Quaternion())).multiplyScalar(4));
  }

  private face(now: number) {
    const a = this.avatar;
    const w = new Map<string, number>(SHAPES.map((n) => [n, 0]));
    const add = (shapes: [string, number][], k: number) => shapes.forEach(([n, v]) => w.set(n, Math.min(1, (w.get(n) ?? 0) + v * k)));
    const weight = (e: Expression) => {
      const x = now - e.start;
      return x < 0 ? 0 : x < e.rise ? ease(x / e.rise) : x < e.rise + e.hold ? 1 : ease(1 - (x - e.rise - e.hold) / e.fall);
    };
    const over = (e: Expression) => now > e.start + e.rise + e.hold + e.fall;

    // Now and then a passing look, unless a win or a loss is showing.
    if (!this.expression && !this.mood && now >= this.nextExpression) {
      this.expression = { shapes: EXPRESSIONS[Math.floor(this.rnd() * EXPRESSIONS.length)]!, start: now, rise: 500 + this.rnd() * 400, hold: 800 + this.rnd() * 1800, fall: 700 + this.rnd() * 500 };
    }
    if (this.expression) {
      add(this.expression.shapes, weight(this.expression));
      if (over(this.expression)) {
        this.expression = null;
        this.nextExpression = now + 5000 + this.rnd() * 9000;
      }
    }
    if (this.mood) {
      add(this.mood.shapes, weight(this.mood));
      if (over(this.mood)) this.mood = null;
    }

    // Eyes: the look, as the ARKit shapes name it (in and out are per eye; the character's left is +yaw).
    const range = 0.45;
    const yaw = THREE.MathUtils.clamp(this.eyes.yaw / range, -1, 1);
    const pitch = THREE.MathUtils.clamp(this.eyes.pitch / range, -1, 1);
    if (yaw > 0) (w.set("EyeLookOutLeft", yaw), w.set("EyeLookInRight", yaw));
    else (w.set("EyeLookInLeft", -yaw), w.set("EyeLookOutRight", -yaw));
    if (pitch > 0) (w.set("EyeLookUpLeft", pitch), w.set("EyeLookUpRight", pitch));
    else (w.set("EyeLookDownLeft", -pitch), w.set("EyeLookDownRight", -pitch));

    // Blinks at uneven intervals, now and then two in a row; the lids drop a little looking down.
    if (now >= this.blink.next && this.blink.start < 0) this.blink.start = now;
    let lid = Math.max(0, -pitch) * 0.25;
    if (this.blink.start >= 0) {
      const x = (now - this.blink.start) / 150;
      lid = Math.max(lid, Math.sin(Math.min(1, x) * Math.PI));
      if (x >= 1) {
        this.blink.start = -1;
        const again = !this.blink.again && this.rnd() < 0.15;
        this.blink.again = again;
        this.blink.next = now + (again ? 120 : 1800 + this.rnd() * 4500);
      }
    }
    w.set("EyeBlinkLeft", Math.max(w.get("EyeBlinkLeft")!, lid));
    w.set("EyeBlinkRight", Math.max(w.get("EyeBlinkRight")!, lid));
    for (const [n, v] of w) a.face(n, v);
  }
}
