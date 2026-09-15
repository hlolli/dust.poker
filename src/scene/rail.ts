import * as THREE from "three";
import type { Action, TableState } from "../referee/types.ts";
import { seatPose } from "./table.ts";
import { Label } from "./text.ts";

const BTN = { font: "bold 72px Georgia, serif", canvas: [512, 128] as [number, number], color: "#f6f1e6" };

/**
 * The player's controls, on the rail in front of their seat: FOLD, CHECK/CALL, RAISE,
 * and a raise amount with - and +. All WebGL; the same meshes answer mouse and XR rays.
 * Keyboard: F, C, R, and arrow keys for the amount.
 */
export class Rail {
  readonly group = new THREE.Group();
  private readonly fold = new Label("FOLD", { width: 0.22, background: "#6e1420", ...BTN });
  private readonly call = new Label("CHECK", { width: 0.28, background: "#1f5f3a", ...BTN });
  private readonly raise = new Label("RAISE", { width: 0.28, background: "#8a6a1c", ...BTN });
  private readonly minus = new Label("-", { width: 0.09, background: "#3a2a18", ...BTN });
  private readonly plus = new Label("+", { width: 0.09, background: "#3a2a18", ...BTN });
  private readonly amount = new Label("", { width: 0.18, color: "#ffe9b0", font: "bold 72px Georgia, serif", canvas: [512, 128] });
  private state: TableState | null = null;
  private raiseTo = 0;

  constructor(
    you: number,
    private readonly act: (a: Action) => void,
    register: (o: THREE.Object3D) => void,
  ) {
    const { position, yaw } = seatPose(you);
    this.group.name = "rail";
    this.group.position.copy(position);
    this.group.rotation.y = yaw;

    // Local frame: the seat looks along -z; the rail is ahead at about z = -0.45.
    const place = (l: Label, x: number, z: number, y = 0.88) => {
      l.mesh.position.set(x, y, z);
      l.mesh.rotation.x = -0.8;
      this.group.add(l.mesh);
    };
    place(this.fold, -0.32, -0.44);
    place(this.call, 0, -0.44);
    place(this.raise, 0.33, -0.44);
    place(this.minus, 0.19, -0.32, 0.85);
    place(this.amount, 0.33, -0.32, 0.85);
    place(this.plus, 0.47, -0.32, 0.85);

    const handlers = new Map<THREE.Object3D, () => void>([
      [this.fold.mesh, () => this.state?.legal && act({ type: "fold" })],
      [this.call.mesh, () => this.state?.legal && act(this.state.legal.check ? { type: "check" } : { type: "call" })],
      [this.raise.mesh, () => this.state?.legal?.raise && act({ type: "raise", to: this.raiseTo })],
      [this.minus.mesh, () => this.step(-1)],
      [this.plus.mesh, () => this.step(1)],
    ]);
    for (const m of handlers.keys()) register(m);
    this.onSelect = (o) => handlers.get(o)?.();

    window.addEventListener("keydown", (e) => {
      if (!this.state?.legal) return;
      if (e.key === "f" || e.key === "F") handlers.get(this.fold.mesh)!();
      else if (e.key === "c" || e.key === "C") handlers.get(this.call.mesh)!();
      else if (e.key === "r" || e.key === "R") handlers.get(this.raise.mesh)!();
      else if (e.key === "ArrowUp" || e.key === "ArrowRight") this.step(1);
      else if (e.key === "ArrowDown" || e.key === "ArrowLeft") this.step(-1);
    });
  }

  /** Give this to the controls' onSelect. */
  readonly onSelect: (o: THREE.Object3D) => void;

  private step(dir: number) {
    const r = this.state?.legal?.raise;
    if (!r) return;
    const stepBy = this.state!.bigBlind;
    this.raiseTo = THREE.MathUtils.clamp(this.raiseTo + dir * stepBy, r.min, r.max);
    if (dir > 0 && this.raiseTo > r.max - stepBy) this.raiseTo = r.max; // last step lands on all-in
    this.render();
  }

  update(s: TableState) {
    const wasMyTurn = !!this.state?.legal;
    this.state = s;
    if (s.legal && !wasMyTurn) this.raiseTo = s.legal.raise?.min ?? 0;
    this.render();
  }

  private render() {
    const legal = this.state?.legal;
    const on = !!legal;
    for (const l of [this.fold, this.call, this.raise, this.minus, this.plus, this.amount]) {
      l.mesh.material.opacity = on ? 1 : 0.35;
    }
    if (!legal) return;
    this.call.set(legal.check ? "CHECK" : `CALL ${legal.call}`);
    const r = legal.raise;
    for (const l of [this.raise, this.minus, this.plus, this.amount]) l.mesh.visible = !!r;
    if (r) {
      this.raise.set(this.state!.street === "preflop" || legal.call > 0 || r.min > this.state!.bigBlind ? "RAISE" : "BET");
      this.amount.set(this.raiseTo === r.max ? `${this.raiseTo} ALL IN` : String(this.raiseTo));
    }
  }
}
