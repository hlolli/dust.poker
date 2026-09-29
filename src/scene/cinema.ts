import * as THREE from "three";

/**
 * A film shot at a deal's end, while the pot goes to the winner: the camera leaves your eyes,
 * makes one move around the table watching the chips, and comes back to your eyes looking where
 * you looked. On a screen only: in a headset the camera is the player's head, never moved for them.
 *
 * - `orbit`: a slow half-circle around the table at standing height.
 * - `crane`: from above the table, rising, looking down at the chips.
 * - `shoulder`: over the winner's shoulder, easing in, the pot coming to them.
 * - `dealer`: from behind the dealer, the winner across the table.
 */
export type Shot = "orbit" | "crane" | "shoulder" | "dealer";
export const SHOTS: Shot[] = ["orbit", "crane", "shoulder", "dealer"];

type Run = {
  shot: Shot;
  start: number;
  ms: number;
  /** What the shot watches, each frame (the pot on its way). */
  look: () => THREE.Vector3;
  winner: THREE.Vector3;
  dealer: THREE.Vector3;
  /** Where the camera was, in the world, as the shot began; and in the rig, to come back to. */
  from: { position: THREE.Vector3; quaternion: THREE.Quaternion };
  home: { position: THREE.Vector3; quaternion: THREE.Quaternion };
};

const smooth = (k: number) => k * k * (3 - 2 * k);
const UP = new THREE.Vector3(0, 1, 0);

export class Cinema {
  private run: Run | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly rig: THREE.Object3D,
    /** Told as the camera leaves your eyes (true) and as it is back (false): show your head meanwhile. */
    private readonly away: (out: boolean) => void,
  ) {}

  get active() {
    return this.run !== null;
  }

  start(now: number, ms: number, shot: Shot, look: () => THREE.Vector3, winner: THREE.Vector3, dealer: THREE.Vector3) {
    if (this.run) return;
    const c = this.camera;
    const home = { position: c.position.clone(), quaternion: c.quaternion.clone() };
    const from = { position: c.getWorldPosition(new THREE.Vector3()), quaternion: c.getWorldQuaternion(new THREE.Quaternion()) };
    this.scene.attach(c);
    this.run = { shot, start: now, ms, look, winner, dealer, from, home };
    this.away(true);
  }

  /** Moves the camera for this frame; returns whether a shot is running. */
  frame(now: number): boolean {
    const r = this.run;
    if (!r) return false;
    const t = (now - r.start) / r.ms;
    if (t >= 1) {
      this.end();
      return false;
    }
    const target = r.look();
    const position = this.path(r, t);
    const view = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(position, target, UP));
    const c = this.camera;
    if (t < 0.15) {
      // Out of your eyes.
      const k = smooth(t / 0.15);
      c.position.lerpVectors(r.from.position, position, k);
      c.quaternion.slerpQuaternions(r.from.quaternion, view, k);
    } else if (t > 0.8) {
      // Back into them, looking where you looked.
      const k = smooth((t - 0.8) / 0.2);
      this.rig.updateMatrixWorld(true);
      const eye = this.rig.localToWorld(r.home.position.clone());
      const eyeQ = this.rig.getWorldQuaternion(new THREE.Quaternion()).multiply(r.home.quaternion);
      c.position.lerpVectors(position, eye, k);
      c.quaternion.slerpQuaternions(view, eyeQ, k);
    } else {
      c.position.copy(position);
      c.quaternion.copy(view);
    }
    return true;
  }

  /** Cuts the shot short (a new deal, a headset put on): straight back to your eyes. */
  end() {
    const r = this.run;
    if (!r) return;
    this.rig.attach(this.camera);
    this.camera.position.copy(r.home.position);
    this.camera.quaternion.copy(r.home.quaternion);
    this.run = null;
    this.away(false);
  }

  /** Where the camera is along the shot, in the world. */
  private path(r: Run, t: number): THREE.Vector3 {
    const out = (p: THREE.Vector3) => new THREE.Vector3(p.x, 0, p.z).normalize();
    const across = (p: THREE.Vector3) => new THREE.Vector3(p.z, 0, -p.x).normalize();
    switch (r.shot) {
      case "orbit": {
        const a = Math.atan2(r.from.position.x, r.from.position.z) + (t - 0.5) * 1.3;
        return new THREE.Vector3(Math.sin(a) * 2.5, 1.75 + t * 0.25, Math.cos(a) * 2.5);
      }
      case "crane": {
        const toYou = out(r.from.position);
        return toYou.clone().multiplyScalar(0.9 - t * 0.6).setY(1.7 + t * 1.3);
      }
      case "shoulder":
        return r.winner.clone().addScaledVector(out(r.winner), 0.62 - t * 0.18).addScaledVector(across(r.winner), 0.32).setY(1.5 - t * 0.1);
      case "dealer":
        return r.dealer.clone().addScaledVector(out(r.dealer), 0.6).addScaledVector(across(r.dealer), -0.3).setY(1.8 - t * 0.12);
    }
  }
}
