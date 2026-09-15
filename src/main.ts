import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { PracticeReferee } from "./referee/practice.ts";
import { createSeat } from "./scene/avatar.ts";
import { type Avatar, cardAnchor, eyePosition, hideOwnHead, idleFace, loadAvatar, poseSeated } from "./scene/avatars.ts";
import youUrl from "./assets/avatars/Business_Male_01.glb";
import bot1Url from "./assets/avatars/Business_Female_02.glb";
import bot2Url from "./assets/avatars/Business_Male_04.glb";
import bot3Url from "./assets/avatars/Female_Party_01.glb";
import bot4Url from "./assets/avatars/Business_Male_06.glb";
import bot5Url from "./assets/avatars/Female_Party_02.glb";
import { attachControls } from "./scene/controls.ts";
import { Rail } from "./scene/rail.ts";
import { createRoom } from "./scene/room.ts";
import { createSplash } from "./scene/splash.ts";
import { freeze } from "./scene/static.ts";
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
// Marble and brass need something to reflect; a generated room environment is cheap and enough.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
pmrem.dispose();
const room = createRoom();
const table = createTable();
scene.add(room, table);

const seats = new THREE.Group();
seats.name = "seats";
for (let i = 0; i < SEAT_COUNT; i++) {
  const { position, yaw } = seatPose(i);
  const seat = createSeat(null); // chairs only; the people are loaded avatars
  seat.position.copy(position);
  seat.rotation.y = yaw;
  seats.add(seat);
}
scene.add(seats);

// One Rocketbox character per seat, seated and facing the table. They load in the background
// while the splash is up; whoever is at the table when you sit down hands you the cards.
const AVATAR_URLS = [youUrl, bot1Url, bot2Url, bot3Url, bot4Url, bot5Url];
// Rocketbox characters come out of Blender facing +z; seats face -z, hence the half turn.
const AVATAR_FACING = Math.PI;
const avatars: (Avatar | null)[] = Array.from({ length: SEAT_COUNT }, () => null);
/** Camera position inside the rig once seated: your avatar's eyes, or a default seated eye height. */
const seatedEye = new THREE.Vector3(0, EYE_HEIGHT, 0);
let attachCards: ((seat: number, avatar: Avatar) => void) | null = null;
for (let i = 0; i < SEAT_COUNT; i++) {
  loadAvatar(AVATAR_URLS[i]!)
    .then((a) => {
      const { position, yaw } = seatPose(i);
      a.root.position.copy(position);
      a.root.rotation.y = yaw + AVATAR_FACING;
      a.root.name = `avatar-${i}`;
      poseSeated(a, 0.5);
      if (i === YOU) {
        // First person: the camera goes where this body's eyes are, expressed in the rig's
        // space once the rig has moved to the seat (same position and yaw as the seat pose).
        const seat = new THREE.Object3D();
        seat.position.copy(position);
        seat.rotation.y = yaw;
        seat.updateMatrixWorld(true);
        seatedEye.copy(seat.worldToLocal(eyePosition(a)));
        hideOwnHead(a);
      }
      scene.add(a.root);
      avatars[i] = a;
      attachCards?.(i, a);
    })
    .catch((e) => console.warn(`avatar ${i} failed to load`, e));
}

const { group: splash, practiceDoor } = createSplash();
scene.add(splash);

// Nothing above ever moves: world matrices once, then no per-frame matrix work.
for (const o of [room, table, seats, splash]) freeze(o);

// The rig is the player's body: it sits at floor level at a pose in the room.
// The camera is the head, at eye height inside it. XR replaces the head pose.
const rig = new THREE.Group();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 50);
camera.position.y = EYE_HEIGHT;
rig.add(camera);
rig.position.set(0, 0, 5.2); // standing at the hall's entrance end, looking down the nave at the table
scene.add(rig);
// Inspection handles for the browser console; no runtime role.
Object.assign(window as unknown as Record<string, unknown>, { __scene: scene, __rig: rig, __camera: camera });

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
  // GPU resources are not garbage collected; the plaque never comes back.
  practiceDoor.geometry.dispose();
  (practiceDoor.material as THREE.MeshBasicMaterial).map?.dispose();
  (practiceDoor.material as THREE.MeshBasicMaterial).dispose();
  const { position, yaw } = seatPose(YOU);
  moveRigTo(position, yaw, 1800, sitDown);
};
controls.register(practiceDoor);

function sitDown() {
  camera.position.copy(seatedEye);
  camera.rotation.x = -0.35; // look at the felt
  const names = Array.from({ length: SEAT_COUNT }, (_, i) => (i === YOU ? "You" : BOT_NAMES[i - 1]!));
  const referee = new PracticeReferee({ names, you: YOU });
  const view = new TableView(YOU);
  const rail = new Rail(YOU, (a) => referee.act(a).catch(console.warn), controls.register);
  scene.add(view.group, rail.group);
  attachCards = (seat, avatar) => view.attachHoleCards(seat, cardAnchor(avatar));
  avatars.forEach((a, i) => a && attachCards!(i, a));
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
  for (const a of avatars) if (a) idleFace(a, now);
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
