import * as THREE from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { PracticeReferee } from "./referee/practice.ts";
import { createSeat, SHIRT_COLORS } from "./scene/avatar.ts";
import { attachControls } from "./scene/controls.ts";
import { Rail } from "./scene/rail.ts";
import { createRoom } from "./scene/room.ts";
import { createSplash } from "./scene/splash.ts";
import { createTable, EYE_HEIGHT, SEAT_COUNT, seatPose } from "./scene/table.ts";
import { TableView } from "./scene/table-view.ts";

const YOU = 0;
const BOT_NAMES = ["Dean", "Frank", "Sammy", "Peggy", "Louis"];

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.xr.enabled = true;
document.body.append(renderer.domElement, VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.add(createRoom(), createTable());

for (let i = 0; i < SEAT_COUNT; i++) {
  const { position, yaw } = seatPose(i);
  const seat = createSeat(i === YOU ? null : SHIRT_COLORS[i]!); // your own body is not drawn
  seat.position.copy(position);
  seat.rotation.y = yaw;
  scene.add(seat);
}

const { group: splash, practiceDoor } = createSplash();
scene.add(splash);

// The rig is the player's body: it sits at floor level at a pose in the room.
// The camera is the head, at eye height inside it. XR replaces the head pose.
const rig = new THREE.Group();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 50);
camera.position.y = EYE_HEIGHT;
rig.add(camera);
rig.position.set(0, 0, 4.6); // standing by the elevator, looking at the sign and the table
scene.add(rig);

// Move the rig to a pose over `ms`; drives the render loop below.
let move: { from: THREE.Vector3; to: THREE.Vector3; yawFrom: number; yawTo: number; t0: number; ms: number; then?: () => void } | null =
  null;
function moveRigTo(to: THREE.Vector3, yaw: number, ms: number, then?: () => void) {
  move = { from: rig.position.clone(), to, yawFrom: rig.rotation.y, yawTo: yaw, t0: performance.now(), ms, then };
}

let onSelect: (hit: THREE.Object3D) => void = () => {};
const controls = attachControls(renderer, camera, rig, (hit) => onSelect(hit));

onSelect = (hit) => {
  if (hit !== practiceDoor) return;
  controls.unregister(practiceDoor);
  splash.remove(practiceDoor);
  const { position, yaw } = seatPose(YOU);
  moveRigTo(position, yaw, 1800, sitDown);
};
controls.register(practiceDoor);

function sitDown() {
  camera.rotation.x = -0.35; // look at the felt
  const names = Array.from({ length: SEAT_COUNT }, (_, i) => (i === YOU ? "You" : BOT_NAMES[i - 1]!));
  const referee = new PracticeReferee({ names, you: YOU });
  const view = new TableView(YOU);
  const rail = new Rail(YOU, (a) => referee.act(a).catch(console.warn), controls.register);
  scene.add(view.group, rail.group);
  onSelect = rail.onSelect;
  referee.subscribe((s) => {
    view.update(s);
    rail.update(s);
  });
  referee.start();
}

// Checked every frame rather than on the resize event: embedded browsers and XR
// session exits have both been seen to skip the event.
const viewport = new THREE.Vector2();
function fitViewport() {
  if (renderer.xr.isPresenting) return;
  renderer.getSize(viewport);
  if (viewport.x === window.innerWidth && viewport.y === window.innerHeight) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

renderer.setAnimationLoop((now) => {
  fitViewport();
  if (move) {
    const k = Math.min(1, (now - move.t0) / move.ms);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in-out
    rig.position.lerpVectors(move.from, move.to, e);
    rig.rotation.y = THREE.MathUtils.lerp(move.yawFrom, move.yawTo, e);
    if (k === 1) {
      const done = move.then;
      move = null;
      done?.();
    }
  }
  renderer.render(scene, camera);
});
