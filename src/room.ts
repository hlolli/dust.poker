import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { ready as runtimeReady } from "./compact/onchain-runtime-shim.js";
import type { Action } from "./referee/types.ts";
import { createSeat } from "./scene/avatar.ts";
import { type Avatar, cardAnchor, eyePosition, hideOwnHead, idleFace, loadAvatar, poseHands, poseSeated, poseStanding } from "./scene/avatars.ts";
import { BAR, BARTENDER_POSE, createBar } from "./scene/bar.ts";
import { attachControls } from "./scene/controls.ts";
import { deckInHand, dressAsDealer } from "./scene/dealer.ts";
import { applyLook } from "./scene/look.ts";
import { startLounge } from "./scene/lounge.ts";
import { MODELS, STAFF_MODEL } from "./scene/models.ts";
import { Rail } from "./scene/rail.ts";
import { createRoom } from "./scene/room.ts";
import { createSplash } from "./scene/splash.ts";
import { freeze } from "./scene/static.ts";
import { createTable, DEALER_POSE, EYE_HEIGHT, SEAT_COUNT, seatPose } from "./scene/table.ts";
import { TableView } from "./scene/table-view.ts";
import { ActionBar } from "./ui/actions.ts";
import type { Profile } from "./ui/profiles.ts";

const YOU = 0;
const BOT_NAMES = ["Dean", "Frank", "Sammy", "Peggy", "Louis"];
// Rocketbox characters come out of Blender facing +z; seats face -z, hence the half turn.
const AVATAR_FACING = Math.PI;

/**
 * The room: the hall, the table, the bar, the people. The player walks in from the entrance
 * and sits at seat 0 of the Practice table as their profile's character; the bots take the
 * other characters. The only module besides main.ts that touches the document.
 */
export async function enterRoom(profile: Profile) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.xr.enabled = true;
  document.body.append(renderer.domElement);
  // Browser first: the VR entry button appears only where WebXR says a headset session is
  // possible, so a desktop browser never shows a warning about it.
  void navigator.xr?.isSessionSupported("immersive-vr").then((ok) => ok && document.body.append(VRButton.createButton(renderer)));

  const scene = new THREE.Scene();
  // Marble and brass need something to reflect; a generated room environment is cheap and enough.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();
  const room = createRoom();
  const table = createTable();
  const bar = createBar();
  const splash = createSplash();
  scene.add(room, table, bar, splash);

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
  // Nothing above ever moves: world matrices once, then no per-frame matrix work.
  for (const o of [room, table, bar, seats, splash]) freeze(o);

  // One character per seat, seated and facing the table: yours from the profile, the bots the
  // rest. They load while you walk in; whoever is there when you sit hands you the cards.
  const yours = MODELS[profile.look.model] ?? MODELS[0]!;
  const others = MODELS.filter((m) => m !== yours);
  const avatars: (Avatar | null)[] = Array.from({ length: SEAT_COUNT }, () => null);
  /** Camera position inside the rig once seated: your avatar's eyes, or a default seated eye height. */
  const seatedEye = new THREE.Vector3(0, EYE_HEIGHT, 0);
  let attachCards: ((seat: number, avatar: Avatar) => void) | null = null;
  for (let i = 0; i < SEAT_COUNT; i++) {
    loadAvatar(i === YOU ? yours.url : others[(i - 1) % others.length]!.url)
      .then((a) => {
        const { position, yaw } = seatPose(i);
        a.root.position.copy(position);
        a.root.rotation.y = yaw + AVATAR_FACING;
        a.root.name = `avatar-${i}`;
        if (i === YOU) applyLook(a, profile.look);
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

  // The house staff, standing: the bartender behind the counter, the dealer at the table's
  // rail across from you. ponytail: the same character for both, until another is converted.
  for (const [name, position, yaw] of [
    ["bartender", BARTENDER_POSE.position, BARTENDER_POSE.rotationY],
    ["dealer", DEALER_POSE.position, DEALER_POSE.yaw + AVATAR_FACING],
  ] as const) {
    loadAvatar(STAFF_MODEL)
      .then((a) => {
        a.root.position.copy(position);
        a.root.rotation.y = yaw;
        a.root.name = name;
        poseStanding(a);
        scene.add(a.root);
        if (name === "dealer") {
          dressAsDealer(a);
          deckInHand(a);
        }
        avatars.push(a); // blinks with the rest
      })
      .catch((e) => console.warn(`${name} failed to load`, e));
  }

  // The rig is the player's body: it sits at floor level at a pose in the room.
  // The camera is the head, at eye height inside it. XR replaces the head pose.
  const rig = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 50);
  camera.position.y = EYE_HEIGHT;
  rig.add(camera);
  rig.position.set(0, 0, 5.2); // at the hall's entrance end, looking down the nave at the table
  scene.add(rig);
  // Inspection handles for the browser console; no runtime role.
  Object.assign(window as unknown as Record<string, unknown>, { __scene: scene, __rig: rig, __camera: camera });

  let onSelect: (hit: THREE.Object3D) => void = () => {};
  const controls = attachControls(renderer, camera, rig, (hit) => onSelect(hit));

  // The band plays from the bar (the menu click was the gesture browsers want). M mutes, as
  // does the note in the corner.
  const lounge = startLounge(camera, scene, new THREE.Vector3(BAR.x - 1.2, 1.4, BAR.z));
  Object.assign(window as unknown as Record<string, unknown>, { __lounge: lounge });
  const mute = document.createElement("button");
  mute.className = "mute";
  mute.type = "button";
  const showMuted = () => {
    mute.textContent = lounge.muted ? "♪ off" : "♪";
    mute.title = lounge.muted ? "The band is muted (M)" : "Mute the band (M)";
    mute.classList.toggle("off", lounge.muted);
  };
  mute.onclick = () => {
    lounge.setMuted(!lounge.muted);
    showMuted();
  };
  showMuted();
  document.body.append(mute);
  window.addEventListener("keydown", (e) => {
    if (e.key === "m" || e.key === "M") mute.click();
  });

  // Walk from the entrance to the seat, then sit down.
  let move: { from: THREE.Vector3; to: THREE.Vector3; yawFrom: number; yawTo: number; t0: number; ms: number; then?: () => void } | null = null;
  const seat = seatPose(YOU);
  move = { from: rig.position.clone(), to: seat.position, yawFrom: rig.rotation.y, yawTo: seat.yaw, t0: performance.now() + 400, ms: 2200, then: () => void sitDown() };

  let view: TableView | null = null;
  async function sitDown() {
    camera.position.copy(seatedEye);
    camera.rotation.x = -0.35; // look at the felt
    const names = Array.from({ length: SEAT_COUNT }, (_, i) => (i === YOU ? profile.name : BOT_NAMES[i - 1]!));
    // The referee is the compiled contract; its runtime's wasm must be up before it is imported.
    await runtimeReady;
    const { ContractReferee } = await import("./referee/contract.ts");
    const referee = new ContractReferee({ names, you: YOU });
    const tableView = (view = new TableView(YOU));
    const act = (a: Action) => referee.act(a).catch(console.warn);
    const show = () => referee.show().catch(console.warn);
    // Browser: the bar at the bottom of the page. Headset: the rail in front of the seat.
    const actionBar = new ActionBar(act, show);
    document.body.append(actionBar.el);
    const rail = new Rail(YOU, act, show, controls.register);
    rail.group.visible = false;
    const inXR = () => {
      rail.group.visible = renderer.xr.isPresenting;
      actionBar.el.hidden = renderer.xr.isPresenting;
    };
    renderer.xr.addEventListener("sessionstart", inXR);
    renderer.xr.addEventListener("sessionend", inXR);
    scene.add(tableView.group, rail.group);
    attachCards = (i, avatar) => tableView.attachHoleCards(i, cardAnchor(avatar), (holding) => poseHands(avatar, holding));
    avatars.forEach((a, i) => a && attachCards!(i, a));
    onSelect = rail.onSelect;
    referee.subscribe((s) => {
      tableView.update(s);
      rail.update(s);
      actionBar.update(s);
      (window as unknown as Record<string, unknown>).__table = s; // inspection handle, like __scene
    });
    Object.assign(window as unknown as Record<string, unknown>, { __referee: referee });
    referee.start().catch(console.error);
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
    view?.animate(now);
    if (move && now >= move.t0) {
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
}
