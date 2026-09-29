import * as THREE from "three";
import type { TableState } from "../referee/types.ts";
import { CARD_W, CardMesh } from "./cards.ts";
import { ChipPile } from "./chips.ts";
import { DEAL_FROM } from "./dealer.ts";
import { EYE_HEIGHT, SEAT_COUNT, SEAT_RADIUS, TABLE_RADIUS, seatPose } from "./table.ts";
import { Label } from "./text.ts";

const FELT_Y = 0.782;
const SMALL = { font: "bold 64px Georgia, serif", canvas: [512, 128] as [number, number] };
// The dealer button, shared by all six seats (only one is visible at a time).
const buttonGeometry = new THREE.CylinderGeometry(0.025, 0.025, 0.008, 24);
const buttonMaterial = new THREE.MeshLambertMaterial({ color: 0xf6f1e6 });
// A hole card at rest in a player's hands: the pair fanned slightly.
const restPosition = (k: number) => new THREE.Vector3((k - 0.5) * 0.035, 0, k * 0.003);
const restZ = (k: number) => (k - 0.5) * -0.3;

/** Renders a TableState onto the table: cards, labels, pot, message. */
export class TableView {
  readonly group = new THREE.Group();
  private readonly board = Array.from({ length: 5 }, () => new CardMesh());
  private readonly hole: CardMesh[][] = [];
  private readonly nameLabels: Label[] = [];
  private readonly betLabels: Label[] = [];
  private readonly buttons: THREE.Mesh[] = [];
  /** Each seat's chips: the stack by the player, and what they have bet this street, out on the felt. */
  private readonly stacks: ChipPile[] = [];
  private readonly bets: ChipPile[] = [];
  private readonly potChips = new ChipPile();
  private readonly pot = new Label("", { width: 0.4, color: "#ffe9b0", ...SMALL });
  private readonly message = new Label("", { width: 1.1, color: "#ffd1ec", glow: "#ff2d95", font: "bold 90px Georgia, serif" });
  /** The hands the hole cards were moved into (attachHoleCards), by seat. */
  private readonly anchors: (THREE.Object3D | null)[] = Array.from({ length: SEAT_COUNT }, () => null);
  /** Poses a seat's hands for holding cards or resting; and whether they hold cards now. */
  private readonly hands: (((holding: boolean) => void) | null)[] = Array.from({ length: SEAT_COUNT }, () => null);
  private readonly holding: boolean[] = Array.from({ length: SEAT_COUNT }, () => false);
  /** Cards in the air between the dealer's hand and a player's, at the start of a deal. */
  private flights: { card: CardMesh; from: THREE.Vector3; up: THREE.Vector3; rest: THREE.Vector3; restZ: number; start: number }[] = [];
  /** Whether each seat's cards lie face down on the felt (placeCards), rather than in the hands. */
  private readonly cardsDown: boolean[] = Array.from({ length: SEAT_COUNT }, () => false);
  /** Cards moving between the hands and the felt, in the parent they now have. */
  private glides: { mesh: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; qFrom: THREE.Quaternion; qTo: THREE.Quaternion; start: number; ms: number }[] = [];
  /** The pot on its way to a winner: a pile sliding across the felt to their stack. */
  private awards: { pile: ChipPile; from: THREE.Vector3; to: THREE.Vector3; start: number; ms: number; seat: number }[] = [];
  /** The deal whose pot was last sent to its winners, by its closing message. */
  private awardedFor = "";
  /** Each seat's stack as the table shows it: a winner's stays as it was until the pot arrives. */
  private readonly shownStack: number[] = Array.from({ length: SEAT_COUNT }, () => 0);
  /** Told when a pot starts toward its winners: each winner and their pile on its way, and how long it takes. */
  onAward: ((piles: { seat: number; pile: THREE.Object3D }[], ms: number) => void) | null = null;
  private street: TableState["street"] = "between";
  /** The last state shown, for the stacks the pot lands on. */
  private latest: TableState | null = null;

  constructor(private readonly you: number) {
    this.group.name = "table-view";
    const eye = seatPose(you).position.clone().setY(EYE_HEIGHT);

    // Board cards are 1.6 m from your eyes; at true size they read as slivers. Scale them
    // and tilt them a little toward the seats so their faces catch the light.
    this.board.forEach((c, i) => {
      c.mesh.position.set((i - 2) * (CARD_W * 1.5 + 0.015), FELT_Y + 0.004, 0);
      c.mesh.scale.setScalar(1.5);
      c.mesh.rotation.x = -Math.PI / 2 + 0.15;
      this.group.add(c.mesh);
    });
    // Pot stands up behind the board, facing you; flat on the felt it was unreadable.
    this.pot.mesh.position.set(0, FELT_Y + 0.06, -0.16);
    this.pot.mesh.lookAt(eye);
    this.group.add(this.pot.mesh);
    // Beside its label, not behind it: the label's plate is see-through, and chips behind it read as printed over the number.
    this.potChips.mesh.position.set(0.32, FELT_Y, -0.2);
    this.group.add(this.potChips.mesh);
    // Over the middle of the table and below the far players' faces, narrow enough for a phone held upright.
    this.message.mesh.position.set(0, 1.0, -0.2);
    this.message.mesh.lookAt(eye);
    this.group.add(this.message.mesh);

    for (let i = 0; i < SEAT_COUNT; i++) {
      const { position, yaw } = seatPose(i);
      const toCentre = position.clone().negate().normalize();
      const mine = i === you;

      // Hole cards near the seat's edge of the felt. Yours sit left of the rail controls
      // and stand up a little so you can read them; your label sits to the right.
      const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      // Other seats' cards stand up slightly toward the table so their backs are visible from
      // across it; yours sit left of the rail controls, tilted up to read.
      const pair = [new CardMesh(), new CardMesh()];
      pair.forEach((c, k) => {
        const p = position.clone().add(toCentre.clone().multiplyScalar(mine ? 0.98 : 0.8));
        if (mine) p.add(side.clone().multiplyScalar(-0.2));
        p.add(side.clone().multiplyScalar((k - 0.5) * (CARD_W + 0.006)));
        c.mesh.position.copy(p).setY(FELT_Y + (mine ? 0.03 : 0.012));
        c.mesh.rotation.set(mine ? -Math.PI / 2 + 0.9 : -Math.PI / 2 + 0.35, 0, 0, "YXZ");
        c.mesh.rotation.y = yaw;
        this.group.add(c.mesh);
      });
      this.hole.push(pair);

      const name = new Label("", { width: 0.34, color: "#f6f1e6", background: "rgba(20,12,8,0.75)", ...SMALL });
      name.mesh.position.copy(position).add(toCentre.clone().multiplyScalar(mine ? 0.98 : 0.45)).setY(mine ? 0.84 : 0.9);
      if (mine) name.mesh.position.add(side.clone().multiplyScalar(0.24));
      name.mesh.lookAt(eye);
      this.group.add(name.mesh);
      this.nameLabels.push(name);

      // The bet: chips out on the felt toward the pot, the amount printed beside them.
      const betChips = new ChipPile();
      betChips.mesh.position.copy(position).add(toCentre.clone().multiplyScalar(1.05)).setY(FELT_Y);
      betChips.mesh.rotation.y = yaw;
      this.group.add(betChips.mesh);
      this.bets.push(betChips);
      const bet = new Label("", { width: 0.16, color: "#ffe9b0", ...SMALL });
      bet.mesh.position.copy(position).add(toCentre.clone().multiplyScalar(1.05)).add(side.clone().multiplyScalar(0.11)).setY(FELT_Y + 0.001);
      bet.mesh.rotation.set(-Math.PI / 2, 0, 0, "YXZ");
      bet.mesh.rotation.y = yaw;
      this.group.add(bet.mesh);
      this.betLabels.push(bet);

      // The stack: at the player's edge of the felt, right of their cards.
      const stack = new ChipPile();
      stack.mesh.position.copy(position).add(toCentre.clone().multiplyScalar(mine ? 0.72 : 0.62)).add(side.clone().multiplyScalar(mine ? 0.3 : 0.16)).setY(FELT_Y);
      stack.mesh.rotation.y = yaw;
      this.group.add(stack.mesh);
      this.stacks.push(stack);

      // Dealer button on the felt beside the seat's cards, clear of the rail controls.
      const button = new THREE.Mesh(buttonGeometry, buttonMaterial);
      button.position.copy(position).add(toCentre.clone().multiplyScalar(0.9)).add(side.clone().multiplyScalar(0.12)).setY(FELT_Y + 0.004);
      this.group.add(button);
      this.buttons.push(button);
    }
  }

  /**
   * Moves a seat's hole cards from the felt into the player's hands: the pair is parented to
   * `anchor` (see `cardAnchor` in avatars.ts, an unscaled holder whose +z faces the player)
   * and fanned slightly. The owner sees the faces, the table sees the backs.
   */
  attachHoleCards(seat: number, anchor: THREE.Object3D, hands?: (holding: boolean) => void) {
    const pair = this.hole[seat];
    if (!pair) return;
    this.anchors[seat] = anchor;
    this.hands[seat] = hands ?? null;
    hands?.(this.holding[seat]!);
    pair.forEach((c, k) => {
      anchor.add(c.mesh);
      c.mesh.position.copy(restPosition(k));
      c.mesh.rotation.set(0, 0, restZ(k));
      c.mesh.scale.setScalar(1);
    });
  }

  /** Where a seat's cards lie when laid down: face down on the felt just inside the rail, within the seated player's reach. World space; `k` picks the card, 0.5 their middle. */
  cardSpot(seat: number, k = 0.5): THREE.Vector3 {
    const { position, yaw } = seatPose(seat);
    const toCentre = position.clone().negate().normalize();
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    return position.clone().addScaledVector(toCentre, SEAT_RADIUS - TABLE_RADIUS + 0.1) // just inside the rail.addScaledVector(side, -0.05 + (k - 0.5) * (CARD_W + 0.004)).setY(FELT_Y + 0.003 + k * 0.001);
  }

  /** Cards are in the air from the deck: the dealer's hand is over it, throwing. */
  get dealing(): boolean {
    return this.flights.length > 0;
  }

  /** Whether a seat's cards are on the felt. */
  isDown(seat: number): boolean {
    return this.cardsDown[seat]!;
  }

  /**
   * Lays a seat's cards face down on the felt before them, or takes them back up into the
   * hands: each card glides from where it is to where it goes, the second a moment after the first.
   */
  placeCards(seat: number, down: boolean, ms = 420, faceUp = false) {
    const pair = this.hole[seat];
    const anchor = this.anchors[seat];
    if (!pair || !anchor || this.cardsDown[seat] === down) return;
    this.cardsDown[seat] = down;
    const { yaw } = seatPose(seat);
    const now = performance.now();
    pair.forEach((c, k) => {
      const parent = down ? this.group : anchor;
      parent.attach(c.mesh); // same place in the world, new parent
      const to = down ? parent.worldToLocal(this.cardSpot(seat, k)) : restPosition(k);
      // Down means face down, unless the cards were shown: then face up, for the table to see.
      const flat = faceUp ? -Math.PI / 2 : Math.PI / 2;
      const qTo = new THREE.Quaternion().setFromEuler(down ? new THREE.Euler(flat, yaw + Math.PI * (faceUp ? 1 : 0) + (k - 0.5) * 0.14, 0, "YXZ") : new THREE.Euler(0, 0, restZ(k)));
      this.flights = this.flights.filter((f) => f.card !== c);
      this.glides = this.glides.filter((g) => g.mesh !== c.mesh);
      this.glides.push({ mesh: c.mesh, from: c.mesh.position.clone(), to, qFrom: c.mesh.quaternion.clone(), qTo, start: now + k * 70, ms });
    });
  }

  /** Puts a seat's cards back in its hands at once: the dealer throws into the hands. */
  private toHands(seat: number) {
    const pair = this.hole[seat];
    const anchor = this.anchors[seat];
    if (!pair || !anchor) return;
    this.cardsDown[seat] = false;
    pair.forEach((c, k) => {
      this.glides = this.glides.filter((g) => g.mesh !== c.mesh);
      anchor.add(c.mesh);
      c.mesh.position.copy(restPosition(k));
      c.mesh.rotation.set(0, 0, restZ(k));
    });
  }

  /** Sends the pot to the winners: a pile of each one's winnings slides from the middle to their stack. */
  private award(s: TableState, winners: number[]) {
    const now = performance.now();
    const delay = 500;
    const ms = 1900;
    const piles: { seat: number; pile: THREE.Object3D }[] = [];
    for (const w of winners) {
      const gain = s.seats[w]!.stack - this.shownStack[w]!;
      if (gain <= 0) continue;
      const pile = new ChipPile();
      pile.set(gain);
      const from = this.potChips.mesh.position.clone();
      pile.mesh.position.copy(from);
      pile.mesh.rotation.y = seatPose(w).yaw;
      this.group.add(pile.mesh);
      this.awards.push({ pile, from, to: this.stacks[w]!.mesh.position.clone(), start: now + delay, ms, seat: w });
      piles.push({ seat: w, pile: pile.mesh });
    }
    if (piles.length) this.onAward?.(piles, delay + ms);
  }

  /**
   * The dealer throws the cards: one to each player in hand clockwise from the button, then a
   * second round, each card flying from the dealer's hands into the player's. Cards whose seat
   * has no hands yet (avatar still loading) simply appear.
   */
  private deal(s: TableState) {
    const now = performance.now();
    const order: number[] = [];
    for (let k = 1; k <= SEAT_COUNT; k++) {
      const i = (s.dealer + k) % SEAT_COUNT;
      if (s.seats[i]!.inHand) order.push(i);
    }
    let n = 0;
    this.flights = [];
    for (const i of order) this.toHands(i);
    for (const k of [0, 1]) {
      for (const i of order) {
        const anchor = this.anchors[i];
        if (!anchor) continue;
        anchor.updateMatrixWorld(true);
        const origin = new THREE.Vector3();
        anchor.getWorldPosition(origin);
        const card = this.hole[i]![k]!;
        const from = anchor.worldToLocal(DEAL_FROM.clone());
        const up = anchor.worldToLocal(origin.clone().add(new THREE.Vector3(0, 1, 0)));
        this.flights.push({ card, from, up, rest: restPosition(k), restZ: restZ(k), start: now + 250 + n++ * 140 });
        card.mesh.position.copy(from);
      }
    }
  }

  /** Advances the cards in flight, the cards gliding and the pot on its way; call once a frame. */
  animate(now: number) {
    const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
    this.glides = this.glides.filter((g) => {
      const t = Math.max(0, Math.min(1, (now - g.start) / g.ms));
      const e = ease(t);
      // A card lifts a little on its way, as it is picked up or put down.
      g.mesh.position.lerpVectors(g.from, g.to, e).y += Math.sin(Math.PI * t) * 0.04 * (g.mesh.parent === this.group ? 1 : 0.3);
      g.mesh.quaternion.slerpQuaternions(g.qFrom, g.qTo, e);
      return t < 1;
    });
    this.awards = this.awards.filter((a) => {
      const t = Math.max(0, Math.min(1, (now - a.start) / a.ms));
      a.pile.mesh.position.lerpVectors(a.from, a.to, ease(t)).y += Math.sin(Math.PI * t) * 0.015; // slid, not thrown
      if (t < 1) return true;
      // Home: the pile joins the stack, which now shows what the table says.
      this.group.remove(a.pile.mesh);
      a.pile.mesh.dispose();
      this.shownStack[a.seat] = this.latest?.seats[a.seat]?.stack ?? this.shownStack[a.seat]!;
      this.stacks[a.seat]!.set(this.shownStack[a.seat]!);
      return false;
    });
    if (!this.flights.length) return;
    this.flights = this.flights.filter((f) => {
      const t = (now - f.start) / 280;
      if (t < 0) {
        f.card.mesh.position.copy(f.from);
        return true;
      }
      const e = Math.min(1, t);
      const k = 1 - (1 - e) * (1 - e); // ease out: thrown, then settling
      f.card.mesh.position.lerpVectors(f.from, f.rest, k).addScaledVector(f.up, Math.sin(Math.PI * e) * 0.12);
      f.card.mesh.rotation.set(0, 0, f.restZ + (1 - k) * Math.PI * 3);
      return e < 1;
    });
  }

  update(s: TableState) {
    if (s.street === "preflop" && this.street !== "preflop") this.deal(s);
    this.street = s.street;
    this.latest = s;
    this.board.forEach((c, i) => c.show(s.board[i] ?? null));
    // A deal won: once per deal, the pot goes to its winners.
    const winners = s.seats.flatMap((seat, i) => (seat.isWinner ? [i] : []));
    const closing = s.street === "between" && winners.length ? s.message : "";
    if (closing && closing !== this.awardedFor) {
      this.awardedFor = closing;
      this.award(s, winners);
    }
    // The pot's chips are what is already collected: the pot less the bets still out on the felt.
    // Once a deal is won the pot is the winners' (the state still counts it until the next deal).
    const pot = closing ? 0 : s.pot;
    this.pot.set(pot > 0 ? `POT ${pot}` : "");
    this.potChips.set(closing ? 0 : pot - s.seats.reduce((a, seat) => a + seat.bet, 0));
    this.message.set(s.message);

    s.seats.forEach((seat, i) => {
      const pair = this.hole[i]!;
      const face = seat.inHand ? (seat.hole ? seat.hole : ["back", "back"]) : [null, null];
      pair.forEach((c, k) => c.show(face[k] as never));
      if (seat.inHand !== this.holding[i]) {
        this.holding[i] = seat.inHand;
        this.hands[i]?.(seat.inHand);
      }

      const name = this.nameLabels[i]!;
      name.mesh.visible = seat.name !== null;
      if (seat.name) {
        const who = i === s.you ? "You" : seat.name;
        const status = seat.allIn ? "ALL IN" : seat.lastAction ?? "";
        const line = `${who}  ${seat.stack}${status ? `  ${status}` : ""}`;
        const turn = s.toAct === i;
        name.set(line, {
          color: seat.folded ? "#8a8078" : seat.isWinner ? "#ffe066" : turn ? "#fff3b0" : "#f6f1e6",
          background: turn ? "rgba(120,80,10,0.9)" : "rgba(20,12,8,0.75)",
        });
      }
      this.betLabels[i]!.set(seat.bet > 0 ? String(seat.bet) : "");
      this.bets[i]!.set(seat.bet);
      // A winner's stack waits for the pot to arrive (animate).
      if (!this.awards.some((a) => a.seat === i)) this.shownStack[i] = seat.name ? seat.stack : 0;
      this.stacks[i]!.set(this.shownStack[i]!);
      this.buttons[i]!.visible = s.dealer === i && seat.name !== null;
    });
  }
}
