import type { TableState } from "../referee/types.ts";
import { type ArmPose, type Avatar, poseHands } from "./avatars.ts";
import type { TableView } from "./table-view.ts";

/**
 * How one seated player handles their cards and rests their arms between the moments the game
 * decides: cards in both hands to read when they arrive and when it is their turn, and
 * otherwise laid face down on the felt, a hand over them or the arms folded or in the lap, with
 * a look now and then. A player out of the hand rests as they like, changing now and then. The
 * choices are the player's own habit (a seeded pick), so no two sit alike and none sits still.
 */
export class Manner {
  private pose: ArmPose | null = null;
  private down = false;
  /** When the current way of sitting was taken up, and when to change it. */
  private until = 0;
  /** When the cards arrived: they are read first. */
  private dealtAt = -Infinity;
  private inHand = false;
  /** Out of play for the pot's journey: the arms are drawing chips in. */
  private busyUntil = 0;
  private readonly rnd: () => number;

  constructor(
    private readonly avatar: Avatar,
    private readonly seat: number,
    private readonly view: TableView,
    /** Your own seat: you read your cards when they come and when you act, and lay them down between. */
    private readonly mine: boolean,
    private readonly lift: number,
  ) {
    let s = (seat + 7) * 2246822519;
    this.rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  }

  /** Holding nothing in the hands: cards on the felt or none. Such a player looks about more (life.ts). */
  get idle(): boolean {
    return this.pose !== "hold";
  }

  /** The arms are the pot's until `until`; then back to how they sat. */
  busy(until: number) {
    this.busyUntil = until;
  }

  /** Call every frame: takes up the next way of sitting when it is time or the table asks. */
  update(now: number, s: TableState | null) {
    if (!s || now < this.busyUntil) return;
    if (this.busyUntil) {
      this.busyUntil = 0;
      this.pose = null; // re-pose after the pot
    }
    const me = s.seats[this.seat];
    if (!me) return;
    if (me.inHand && !this.inHand) this.dealtAt = now;
    this.inHand = me.inHand;
    const deciding = s.toAct === this.seat;
    const reading = now - this.dealtAt < (this.mine ? 3500 : 2500 + this.rnd() * 2500);
    const shown = s.street === "showdown";
    if (me.inHand && (deciding || reading || shown)) return this.take("hold", false, now + 800);
    if (now < this.until && this.pose !== null) return;
    if (!me.inHand) {
      const rests: ArmPose[] = ["rail", "crossed", "lap"];
      return this.take(rests[Math.floor(this.rnd() * rests.length)]!, false, now + 12000 + this.rnd() * 18000);
    }
    // In the hand, not acting: the cards go down, and now and then back up for a look.
    if (this.mine) return this.take("rail", true, Infinity);
    const r = this.rnd();
    if (this.pose !== "hold" && r < 0.25) return this.take("hold", false, now + 1500 + this.rnd() * 1500); // a peek
    const ways: [ArmPose, boolean][] = [["rail", true], ["cover", true], ["crossed", true], ["lap", true], ["hold", false]];
    const [pose, down] = ways[Math.floor(this.rnd() * ways.length)]!;
    this.take(pose, down, now + 6000 + this.rnd() * 14000);
  }

  private take(pose: ArmPose, down: boolean, until: number) {
    this.until = until;
    if (pose === this.pose && down === this.down) return;
    this.pose = pose;
    this.down = down;
    this.view.placeCards(this.seat, down);
    poseHands(this.avatar, pose, this.lift, pose === "cover" ? this.view.cardSpot(this.seat) : undefined);
  }
}
