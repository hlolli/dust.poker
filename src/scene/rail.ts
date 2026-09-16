import * as THREE from "three";
import type { Action, TableState } from "../referee/types.ts";
import { seatPose } from "./table.ts";
import { Label } from "./text.ts";

const BTN = { font: "bold 72px Georgia, serif", canvas: [512, 128] as [number, number], color: "#f6f1e6" };

/**
 * The player's controls in a headset, on the rail in front of their seat: FOLD, CHECK/CALL,
 * RAISE, a raise amount with - and +, and SHOW once a deal is over. All WebGL, answering XR
 * rays. In a browser window the bar at the bottom of the page (ui/actions.ts) is used instead.
 */
export class Rail {
  readonly group = new THREE.Group();
  private readonly fold = new Label("FOLD", { width: 0.22, background: "#6e1420", ...BTN });
  private readonly call = new Label("CHECK", { width: 0.28, background: "#1f5f3a", ...BTN });
  private readonly raise = new Label("RAISE", { width: 0.28, background: "#8a6a1c", ...BTN });
  private readonly minus = new Label("-", { width: 0.09, background: "#3a2a18", ...BTN });
  private readonly plus = new Label("+", { width: 0.09, background: "#3a2a18", ...BTN });
  private readonly amount = new Label("", { width: 0.18, color: "#ffe9b0", font: "bold 72px Georgia, serif", canvas: [512, 128] });
  private readonly show = new Label("SHOW", { width: 0.22, background: "#2a3a6e", ...BTN });
  // The clock: seconds left to act, and the time bank behind them, ticking once a second.
  private readonly clock = new Label("", { width: 0.5, color: "#ffe9b0", font: "bold 90px Georgia, serif", canvas: [512, 128] });
  private state: TableState | null = null;
  private raiseTo = 0;

  constructor(
    you: number,
    private readonly act: (a: Action) => void,
    show: () => void,
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
    place(this.show, -0.32, -0.32, 0.85);
    place(this.clock, -0.62, -0.4, 0.92); // left of FOLD, clear of the cards in your hands
    setInterval(() => this.tick(), 1000);

    const handlers = new Map<THREE.Object3D, () => void>([
      [this.fold.mesh, () => this.state?.legal && act({ type: "fold" })],
      [this.call.mesh, () => this.state?.legal && act(this.state.legal.check ? { type: "check" } : { type: "call" })],
      [this.raise.mesh, () => this.state?.legal?.raise && act({ type: "raise", to: this.raiseTo })],
      [this.minus.mesh, () => this.step(-1)],
      [this.plus.mesh, () => this.step(1)],
      [this.show.mesh, () => this.state?.canShow && show()],
    ]);
    for (const m of handlers.keys()) register(m);
    this.onSelect = (o) => handlers.get(o)?.();
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
    this.tick();
  }

  /** Your seconds left when it is your turn: the 30 first, then the bank, in a warmer colour. */
  private tick() {
    const s = this.state;
    if (!s?.legal || s.deadline === null) {
      this.clock.set("");
      return;
    }
    const left = Math.max(0, s.deadline - Math.floor(Date.now() / 1000));
    const onBank = left <= s.timeBank;
    this.clock.set(onBank ? `BANK ${left}` : `${left - s.timeBank}`, { color: onBank ? "#ff9a6b" : "#ffe9b0" });
  }

  private render() {
    const legal = this.state?.legal;
    const on = !!legal;
    for (const l of [this.fold, this.call, this.raise, this.minus, this.plus, this.amount]) {
      l.mesh.material.opacity = on ? 1 : 0.35;
    }
    this.show.mesh.visible = !!this.state?.canShow;
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
