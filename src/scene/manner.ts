import * as THREE from "three";
import type { TableState } from "../referee/types.ts";
import { type ArmPose, type Avatar, holdCards, passRail, poseHands, turn } from "./avatars.ts";
import { HAND_APPROACH_MS, type TableView } from "./table-view.ts";

const ACROSS = new THREE.Vector3(1, 0, 0);
const SIDES = ["L", "R"] as const;

/** Chooses the player's resting pose and keeps each hand on its card during a transfer. */
export class Manner {
  private pose: ArmPose = "rail";
  private applied: ArmPose | null = null;
  private until = 0;
  private readUntil = 0;
  private playing = false;
  private street: TableState["street"] | null = null;
  private busyUntil = 0;
  private moving = false;
  private blendStart = 0;
  private fromBody = false;
  private readonly startWrists = { L: new THREE.Vector3(), R: new THREE.Vector3() };
  private readonly from = new Map<THREE.Bone, THREE.Quaternion>();
  private readonly rnd: () => number;

  constructor(private readonly avatar: Avatar, private readonly seat: number, private readonly view: TableView, private readonly mine: boolean) {
    let seed = (seat + 7) * 2246822519;
    this.rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  }

  get idle(): boolean {
    return !this.moving && this.applied !== "hold";
  }

  get handsPlanted(): boolean {
    return this.moving || this.from.size > 0 || this.applied === "hold" || this.applied === "rail" || this.applied === "cover";
  }

  busy(until: number) {
    this.busyUntil = until;
  }

  update(now: number, s: TableState | null) {
    const me = s?.seats[this.seat];
    if (!s || !me) return;
    const shown = !this.mine && me.hole !== null && me.inHand;
    const finished = s.street === "between" && s.seats.some(p => p.isWinner);
    const playing = me.inHand && !me.folded && !finished && !shown;
    if (playing !== this.playing || (s.street === "preflop" && this.street !== s.street)) {
      this.until = 0;
      this.readUntil = playing ? now + (this.mine ? 3500 : 2500 + this.rnd() * 2500) : 0;
    }
    this.playing = playing;
    this.street = s.street;
    if (now >= this.busyUntil && this.busyUntil) {
      this.busyUntil = 0;
      this.applied = null; // the winner's arms have just been drawing in the pot
      this.until = 0;
    }
    if (this.busyUntil || shown || finished) {
      this.pose = "rail";
    } else if (playing && (s.toAct === this.seat || now < this.readUntil || s.street === "showdown")) {
      this.pose = "hold";
      this.until = now + 800;
    } else if (now >= this.until) {
      if (!playing) {
        const rests = ["rail", "crossed", "lap"] as const;
        this.pose = rests[Math.floor(this.rnd() * rests.length)]!;
        this.until = now + 12000 + this.rnd() * 18000;
      } else if (this.mine) {
        this.pose = "rail";
        this.until = Infinity;
      } else {
        const ways = ["rail", "cover", "crossed", "lap", "hold"] as const;
        this.pose = ways[Math.floor(this.rnd() * ways.length)]!;
        this.until = now + (this.pose === "hold" ? 1500 : 6000) + this.rnd() * (this.pose === "hold" ? 1500 : 14000);
      }
    }
    if (me.inHand) this.view.placeCards(this.seat, this.pose !== "hold", 420, shown, now);
    const moving = me.inHand && this.view.movingCards(this.seat);
    const next = moving ? "hold" : this.pose;
    if (next !== this.applied && this.applied !== null) {
      this.blendStart = now;
      this.fromBody = next === "crossed" || next === "lap" || this.applied === "crossed" || this.applied === "lap";
      if (this.fromBody) for (const side of SIDES) this.avatar.hand(side).getWorldPosition(this.startWrists[side]);
      for (const bone of this.avatar.seatRest.keys()) this.from.set(bone, bone.quaternion.clone());
    } else if (next === this.applied && !moving && !this.moving && !this.from.size) return;
    this.applied = next;
    this.moving = moving;
    if (next === "hold") holdCards(this.avatar, this.view.handTargets(this.seat));
    else poseHands(this.avatar, next, next === "cover" ? this.view.cardSpot(this.seat, 1) : undefined);
    const t = THREE.MathUtils.smoothstep(now - this.blendStart, 0, HAND_APPROACH_MS);
    if (this.from.size && t < 1) {
      const ends = this.fromBody ? SIDES.map(side => this.avatar.hand(side).getWorldPosition(new THREE.Vector3())) : null;
      for (const [bone, start] of this.from) bone.quaternion.slerp(start, 1 - t);
      for (const [i, side] of SIDES.entries()) {
        if (ends) passRail(this.avatar, side, this.startWrists[side], ends[i]!, t);
        else turn(this.avatar, `Bip01 ${side} UpperArm`, ACROSS, -6 * Math.sin(Math.PI * t));
      }
    } else this.from.clear();
  }
}
