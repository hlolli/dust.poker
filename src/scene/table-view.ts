import * as THREE from "three";
import type { TableState } from "../referee/types.ts";
import { CARD_W, CardMesh } from "./cards.ts";
import { EYE_HEIGHT, SEAT_COUNT, seatPose } from "./table.ts";
import { Label } from "./text.ts";

const FELT_Y = 0.782;
const SMALL = { font: "bold 64px Georgia, serif", canvas: [512, 128] as [number, number] };
// The dealer button, shared by all six seats (only one is visible at a time).
const buttonGeometry = new THREE.CylinderGeometry(0.025, 0.025, 0.008, 24);
const buttonMaterial = new THREE.MeshLambertMaterial({ color: 0xf6f1e6 });

/** Renders a TableState onto the table: cards, labels, pot, message. */
export class TableView {
  readonly group = new THREE.Group();
  private readonly board = Array.from({ length: 5 }, () => new CardMesh());
  private readonly hole: CardMesh[][] = [];
  private readonly nameLabels: Label[] = [];
  private readonly betLabels: Label[] = [];
  private readonly buttons: THREE.Mesh[] = [];
  private readonly pot = new Label("", { width: 0.4, color: "#ffe9b0", ...SMALL });
  private readonly message = new Label("", { width: 1.6, color: "#ffd1ec", glow: "#ff2d95", font: "bold 90px Georgia, serif" });

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
    this.message.mesh.position.set(0, 1.15, -0.3);
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

      const bet = new Label("", { width: 0.16, color: "#ffe9b0", ...SMALL });
      bet.mesh.position.copy(position).add(toCentre.clone().multiplyScalar(0.98)).setY(FELT_Y + 0.001);
      bet.mesh.rotation.set(-Math.PI / 2, 0, 0, "YXZ");
      bet.mesh.rotation.y = yaw;
      this.group.add(bet.mesh);
      this.betLabels.push(bet);

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
  attachHoleCards(seat: number, anchor: THREE.Object3D) {
    const pair = this.hole[seat];
    if (!pair) return;
    pair.forEach((c, k) => {
      anchor.add(c.mesh);
      c.mesh.position.set((k - 0.5) * 0.035, 0, k * 0.003);
      c.mesh.rotation.set(0, 0, (k - 0.5) * -0.3);
      c.mesh.scale.setScalar(1);
    });
  }

  update(s: TableState) {
    this.board.forEach((c, i) => c.show(s.board[i] ?? null));
    this.pot.set(s.pot > 0 ? `POT ${s.pot}` : "");
    this.message.set(s.message);

    s.seats.forEach((seat, i) => {
      const pair = this.hole[i]!;
      const face = seat.inHand ? (seat.hole ? seat.hole : ["back", "back"]) : [null, null];
      pair.forEach((c, k) => c.show(face[k] as never));

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
      this.buttons[i]!.visible = s.dealer === i && seat.name !== null;
    });
  }
}
