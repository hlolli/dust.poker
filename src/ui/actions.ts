import type { Action, TableState } from "../referee/types.ts";

/**
 * The player's controls for the browser: a bar fixed to the bottom of the page with FOLD,
 * CHECK/CALL, RAISE and its amount, SHOW once a deal is over, and the clock. Keyboard: F, C, R,
 * S, arrows for the amount. Styled in src/index.html (.actions). In a headset the 3D rail
 * (scene/rail.ts) takes over and this bar is hidden.
 */
export class ActionBar {
  readonly el = document.createElement("div");
  private readonly clock = button("", "clock");
  private readonly fold = button("FOLD", "fold");
  private readonly call = button("CHECK", "call");
  private readonly minus = button("-", "step");
  private readonly amount = button("", "amount");
  private readonly plus = button("+", "step");
  private readonly raise = button("RAISE", "raise");
  private readonly show = button("SHOW", "show");
  private state: TableState | null = null;
  private raiseTo = 0;

  constructor(
    private readonly act: (a: Action) => void,
    show: () => void,
  ) {
    this.el.className = "actions";
    this.el.append(this.clock, this.fold, this.call, this.minus, this.amount, this.plus, this.raise, this.show);
    this.fold.onclick = () => this.state?.legal && act({ type: "fold" });
    this.call.onclick = () => this.state?.legal && act(this.state.legal.check ? { type: "check" } : { type: "call" });
    this.raise.onclick = () => this.state?.legal?.raise && act({ type: "raise", to: this.raiseTo });
    this.minus.onclick = () => this.step(-1);
    this.plus.onclick = () => this.step(1);
    this.show.onclick = () => this.state?.canShow && show();
    for (const [b, key] of [[this.fold, "F"], [this.call, "C"], [this.raise, "R"], [this.show, "S"]] as const) b.dataset.key = key;
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement || this.el.hidden) return;
      const k = e.key.toUpperCase();
      if (k === "S") this.show.click();
      else if (k === "F") this.fold.click();
      else if (k === "C") this.call.click();
      else if (k === "R") this.raise.click();
      else if (e.key === "ArrowUp" || e.key === "ArrowRight") this.step(1);
      else if (e.key === "ArrowDown" || e.key === "ArrowLeft") this.step(-1);
    });
    setInterval(() => this.tick(), 1000);
    this.render();
  }

  private step(dir: number) {
    const r = this.state?.legal?.raise;
    if (!r) return;
    const by = this.state!.bigBlind;
    this.raiseTo = Math.min(r.max, Math.max(r.min, this.raiseTo + dir * by));
    if (dir > 0 && this.raiseTo > r.max - by) this.raiseTo = r.max; // the last step lands on all-in
    this.render();
  }

  update(s: TableState) {
    const wasMyTurn = !!this.state?.legal;
    this.state = s;
    if (s.legal && !wasMyTurn) this.raiseTo = s.legal.raise?.min ?? 0;
    this.render();
    this.tick();
  }

  /** Seconds left when it is your turn: the thirty first, then the bank. */
  private tick() {
    const s = this.state;
    if (!s?.legal || s.deadline === null) {
      this.clock.textContent = "";
      this.clock.classList.remove("bank");
      return;
    }
    const left = Math.max(0, s.deadline - Math.floor(Date.now() / 1000));
    const onBank = left <= s.timeBank;
    this.clock.textContent = onBank ? `BANK ${left}` : String(left - s.timeBank);
    this.clock.classList.toggle("bank", onBank);
  }

  private render() {
    const legal = this.state?.legal ?? null;
    for (const b of [this.fold, this.call, this.raise, this.minus, this.plus, this.amount]) b.disabled = !legal;
    this.show.hidden = !this.state?.canShow;
    if (!legal) return;
    // Numbers in the reading face with tabular figures, so a changing amount does not move the word.
    if (legal.check) this.call.textContent = "CHECK";
    else this.call.replaceChildren("CALL ", Object.assign(document.createElement("span"), { className: "n", textContent: String(legal.call) }));
    const r = legal.raise;
    for (const b of [this.raise, this.minus, this.plus, this.amount]) b.hidden = !r;
    if (r) {
      this.raise.textContent = this.state!.street === "preflop" || legal.call > 0 || r.min > this.state!.bigBlind ? "RAISE" : "BET";
      this.amount.textContent = this.raiseTo === r.max ? `${this.raiseTo} ALL IN` : String(this.raiseTo);
    }
  }
}

function button(text: string, kind: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.className = kind;
  return b;
}
