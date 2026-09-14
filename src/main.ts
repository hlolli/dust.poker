import * as THREE from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { createSeat, SHIRT_COLORS } from "./scene/avatar.ts";
import { attachControls } from "./scene/controls.ts";
import { createRoom } from "./scene/room.ts";
import { createSplash } from "./scene/splash.ts";
import { createTable, EYE_HEIGHT, SEAT_COUNT, seatPose } from "./scene/table.ts";

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
  const seat = createSeat(i === 0 ? null : SHIRT_COLORS[i]!); // seat 0 is you; no body drawn
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
let move: { from: THREE.Vector3; to: THREE.Vector3; yawFrom: number; yawTo: number; t0: number; ms: number } | null = null;
function moveRigTo(to: THREE.Vector3, yaw: number, ms: number) {
  move = { from: rig.position.clone(), to, yawFrom: rig.rotation.y, yawTo: yaw, t0: performance.now(), ms };
}

const controls = attachControls(renderer, camera, rig, (hit) => {
  if (hit === practiceDoor) {
    controls.unregister(practiceDoor);
    splash.remove(practiceDoor);
    const { position, yaw } = seatPose(0);
    moveRigTo(position, yaw, 1800);
  }
});
controls.register(practiceDoor);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop((now) => {
  if (move) {
    const k = Math.min(1, (now - move.t0) / move.ms);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in-out
    rig.position.lerpVectors(move.from, move.to, e);
    rig.rotation.y = THREE.MathUtils.lerp(move.yawFrom, move.yawTo, e);
    if (k === 1) move = null;
  }
  renderer.render(scene, camera);
});
