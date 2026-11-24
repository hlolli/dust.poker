import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { type Fx, fxOn, lightTable, postprocessing, reflectRoom, shadowed } from "./scene/fx.ts";
import { texturesReady } from "./scene/materials.ts";
import { ready as runtimeReady } from "./compact/onchain-runtime-shim.js";
import type { Action, Referee, TableState } from "./referee/types.ts";
import { createSeat } from "./scene/avatar.ts";
import { type Avatar, cardAnchor, dealerReach, drawIn, eyePosition, loadAvatar, poseDealer, poseSeated, poseStanding, poseWalking, showOwnHead } from "./scene/avatars.ts";
import { Manner } from "./scene/manner.ts";
import { Cinema, SHOTS } from "./scene/cinema.ts";
import { type Attention, Life } from "./scene/life.ts";
import { BAR, BARTENDER_POSE, createBar } from "./scene/bar.ts";
import { attachControls } from "./scene/controls.ts";
import { deckInHand, dressAsDealer } from "./scene/dealer.ts";
import { applyLook } from "./scene/look.ts";
import { startLounge } from "./scene/lounge.ts";
import { MODELS, STAFF } from "./scene/models.ts";
import { Rail } from "./scene/rail.ts";
import { createRoom } from "./scene/room.ts";
import { createSplash } from "./scene/splash.ts";
import { freeze } from "./scene/static.ts";
import { createTable, DEALER_POSE, EYE_HEIGHT, SEAT_COUNT, seatPose } from "./scene/table.ts";
import { TableView } from "./scene/table-view.ts";
import { ActionBar } from "./ui/actions.ts";
import { HandPanel } from "./ui/hand.ts";
import type { Profile } from "./ui/profiles.ts";
import type { Entry } from "./ui/menu.ts";

/** How much higher than the others you hold your cards: toward the eyes the camera sits in. */
const LIFT = 0.05;
const BOT_NAMES = ["Dean", "Frank", "Sammy", "Peggy", "Louis"];
// Rocketbox characters come out of Blender facing +z; seats face -z, hence the half turn.
const AVATAR_FACING = Math.PI;
/** Where you come in: the hall's entrance end, looking down the nave at the table. */
const ENTRANCE = new THREE.Vector3(0, 0, 5.2);

/**
 * The room: the hall, the table, the bar, the people. The player walks in from the entrance
 * and sits down as their profile's character: at seat 0 of the Practice table, where the bots
 * take the other characters, or at the seat a Live table gave them, where the other players are
 * whoever the chain says is there. The only module besides the ui layer that touches the document.
 */
export async function enterRoom(entry: Entry) {
  const { profile } = entry;
  const YOU = entry.mode === "live" ? entry.seat.index : 0;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.xr.enabled = true;
  document.body.append(renderer.domElement);
  const stats = { frames: 0 }; // inspection handle: window.__stats.frames, for a frame-rate check on any device
  Object.assign(window as unknown as Record<string, unknown>, { __stats: stats });
  // Browser first: the VR entry button appears only where WebXR says a headset session is
  // possible, so a desktop browser never shows a warning about it.
  void navigator.xr?.isSessionSupported("immersive-vr").then((ok) => ok && document.body.append(VRButton.createButton(renderer)));

  const scene = new THREE.Scene();
  // A stand-in to reflect until the hall's own reflection is taken (reflectRoom, below).
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();
  const room = createRoom();
  const table = createTable();
  const study = new URLSearchParams(location.search).get("lounge") === "deco"
    ? await import("./scene/lounge-study.ts").then(m => m.loadLoungeStudy()).catch(error => {
      console.warn("Could not load the Deco lounge study", error);
      return undefined;
    })
    : undefined;
  const bar = createBar(study?.backBar);
  const jukebox = study?.jukebox;
  if (jukebox) bar.add(jukebox.cabinet);
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
  // Only the furniture around the table is inside the lamp's shadow cone.
  if (fxOn()) lightTable(renderer, scene, [table, seats]);
  void reflectRoom(renderer, scene, [room, table, bar, seats, splash], texturesReady());

  // One character per seat, seated and facing the table: yours from the profile, the bots the
  // rest. They load while you walk in; whoever is there when you sit hands you the cards.
  const yours = MODELS[profile.look.model] ?? MODELS[0]!;
  const others = MODELS.filter((m) => m !== yours);
  const avatars: (Avatar | null)[] = Array.from({ length: SEAT_COUNT }, () => null);
  /** What moves each character between poses (scene/life.ts): the seats' and the staff's. */
  const lives = new Map<Avatar, Life>();
  let dealerAvatar: Avatar | null = null;
  /** How each seated player handles their cards and rests (scene/manner.ts), once their cards are theirs. */
  const manners: (Manner | null)[] = Array.from({ length: SEAT_COUNT }, () => null);
  /** The pot on its way to the winners: the dealer pushes it, the winners draw it in. */
  let pot: { start: number; ms: number; piles: { seat: number; pile: THREE.Object3D }[] } | null = null;
  /** The last table state, for where everyone's attention goes. */
  let tableState: TableState | null = null;
  /** Camera position inside the rig once seated: your avatar's eyes, or a default seated eye height. */
  const seatedEye = new THREE.Vector3(0, EYE_HEIGHT, 0);
  /** Your arrival, once your character has loaded; null when you are seated. */
  let entrance: { avatar: Avatar; t0: number } | null = null;
  let attachCards: ((seat: number, avatar: Avatar) => void) | null = null;
  for (let i = 0; i < SEAT_COUNT; i++) {
    loadAvatar(i === YOU ? yours.url : others[(i + (i < YOU ? 0 : -1) + others.length) % others.length]!.url)
      .then((a) => {
        const { position, yaw } = seatPose(i);
        a.root.position.copy(position);
        a.root.rotation.y = yaw + AVATAR_FACING;
        a.root.name = `avatar-${i}`;
        if (i === YOU) {
          // You arrive on foot: standing at the entrance, facing the table, head and all.
          // The entrance below walks you to the chair and sits you down; the camera follows
          // behind until you are seated, then steps into your eyes.
          applyLook(a, profile.look);
          a.root.position.copy(ENTRANCE);
          poseWalking(a, 0);
          scene.add(fxOn() ? shadowed(a.root) : a.root);
          avatars[i] = a;
          lives.set(a, new Life(a, { seed: i, head: false }));
          entrance = { avatar: a, t0: performance.now() + 300 };
          return;
        }
        poseSeated(a, 0.5);
        scene.add(fxOn() ? shadowed(a.root) : a.root);
        avatars[i] = a;
        lives.set(a, new Life(a, { seed: i }));
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
    loadAvatar(STAFF[name])
      .then((a) => {
        a.root.position.copy(position);
        a.root.rotation.y = yaw;
        a.root.name = name;
        if (name === "dealer") poseDealer(a);
        else poseStanding(a);
        scene.add(fxOn() ? shadowed(a.root) : a.root);
        if (name === "dealer") {
          dressAsDealer(a, study?.jacket);
          deckInHand(a, study?.cardBack);
          dealerAvatar = a;
        }
        lives.set(a, new Life(a, { seed: name === "dealer" ? 11 : 12, standing: true }));
      })
      .catch((e) => console.warn(`${name} failed to load`, e));
  }

  // The rig is the player's body: it sits at floor level at a pose in the room.
  // The camera is the head, at eye height inside it. XR replaces the head pose.
  const rig = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 50);
  camera.position.y = EYE_HEIGHT;
  rig.add(camera);
  rig.position.copy(ENTRANCE);
  scene.add(rig);
  // Inspection handles for the browser console; no runtime role.
  Object.assign(window as unknown as Record<string, unknown>, { __scene: scene, __rig: rig, __camera: camera });

  let onSelect: (hit: THREE.Object3D) => void = () => {};
  const lounge = startLounge(camera, scene, jukebox?.speaker ?? new THREE.Vector3(BAR.x - 1.2, 1.4, BAR.z));
  Object.assign(window as unknown as Record<string, unknown>, { __lounge: lounge });
  const mute = document.createElement("button");
  mute.className = "mute";
  mute.type = "button";
  mute.setAttribute("aria-label", "Mute lounge music");
  const showMuted = () => {
    mute.textContent = lounge.muted ? "♪ off" : "♪";
    mute.title = lounge.muted ? "The band is muted (M)" : "Mute the band (M)";
    mute.classList.toggle("off", lounge.muted);
    mute.setAttribute("aria-pressed", String(lounge.muted));
    jukebox?.setMuted(lounge.muted);
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
  const controls = attachControls(renderer, camera, rig, hit => {
    if (!jukebox?.cabinet.getObjectById(hit.id)) return onSelect(hit);
    mute.click();
  });
  jukebox?.cabinet.traverse(o => { if (o instanceof THREE.Mesh) controls.register(o, scene); });

  // Back to the main menu. The page reloads into it: the simplest full teardown of the scene,
  // the renderer and the band, and the page's own address (network, table) is kept.
  const leave = document.createElement("button");
  leave.className = "leave";
  leave.type = "button";
  leave.textContent = entry.mode === "live" ? "Back to menu" : "Leave table";
  leave.title = entry.mode === "live" ? "Back to the menu. Your seat and chips stay yours at the table; take a seat again to come back." : "Back to the menu";
  leave.onclick = () => {
    // On a Live table your client does your steps in a deal; gone, it misses them, and a missed
    // step past its deadline can cost your bond (ADR 0006). Between deals nothing is owed.
    const dealing = entry.mode === "live" && tableState !== null && tableState.street !== "between" && tableState.seats[YOU]?.inHand;
    if (dealing && !confirm("A deal is under way. Leaving now misses your turns in it, and the table can charge your bond for that. Leave anyway?")) return;
    location.reload();
  };
  const tableControls = document.createElement("div");
  tableControls.className = "table-controls";
  tableControls.append(leave);
  document.body.append(tableControls);

  // The entrance: a timeline from the moment your character has loaded. Walk to the side of
  // your chair, pull it out from the table, step in front of it, sit as it slides back under
  // you, then the camera leaves its place behind you for your eyes and the game begins.
  const seat = seatPose(YOU);
  const outward = seat.position.clone().normalize(); // from the table centre out through the seat
  const side = new THREE.Vector3(outward.z, 0, -outward.x); // along the rail, to the chair's side
  const beside = seat.position.clone().addScaledVector(outward, 0.4).addScaledVector(side, 0.62); // standing beside the chair
  const pulled = 0.5; // how far the chair comes out
  const inFront = seat.position.clone().addScaledVector(outward, pulled); // between the pulled chair and the table
  const facingTable = seat.yaw + AVATAR_FACING;
  const chair = seats.children[YOU]!;
  chair.traverse((o) => {
    o.matrixAutoUpdate = true; // this one chair moves
    o.matrixWorldAutoUpdate = true;
  });
  const chairAt = chair.position.clone();
  const STEPS = [3.0, 0.7, 0.7, 0.9, 1.0] as const; // walk, pull the chair, step in front of it, sit, into the eyes
  const smooth = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
  let seatedY = 0;
  let standingY = 0;
  let walkYaw = 0;
  let cameraFrom: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null;
  scene.attach(camera); // free during the entrance; back into the rig once seated
  function entranceFrame(now: number) {
    if (!entrance) return;
    const { avatar } = entrance;
    let t = (now - entrance.t0) / 1000;
    if (t < 0) t = 0;
    let stage = 0;
    while (stage < STEPS.length && t >= STEPS[stage]!) t -= STEPS[stage++]!;
    const k = stage < STEPS.length ? Math.min(1, t / STEPS[stage]!) : 1;
    if (stage === 0) {
      // The walk: from the entrance to beside the chair, facing the way you go, a stride every
      // 0.55 s and a little bob.
      const phase = t * (Math.PI * 2 / 0.55);
      const dir = beside.clone().sub(ENTRANCE);
      walkYaw = Math.atan2(dir.x, dir.z);
      avatar.root.rotation.y = walkYaw;
      avatar.root.position.lerpVectors(ENTRANCE, beside, smooth(k)).setY(Math.abs(Math.sin(phase)) * 0.025);
      poseWalking(avatar, phase);
    } else if (stage === 1) {
      // Pulling the chair out, standing at its side, turning to face the table.
      poseWalking(avatar, 0);
      avatar.root.position.copy(beside);
      avatar.root.rotation.y = THREE.MathUtils.lerp(walkYaw, facingTable, smooth(k));
      chair.position.copy(chairAt).addScaledVector(outward, pulled * smooth(k));
    } else if (stage === 2) {
      // A side step in front of the pulled-out chair.
      poseWalking(avatar, Math.sin(k * Math.PI) * 0.7);
      avatar.root.rotation.y = facingTable;
      avatar.root.position.lerpVectors(beside, inFront, smooth(k));
    } else if (stage === 3) {
      // Sitting: the body lowers onto the chair and rides in with it as it slides back under the table.
      sitOnce(avatar);
      const e = smooth(k);
      avatar.root.position.copy(seat.position).addScaledVector(outward, pulled * (1 - e));
      avatar.root.position.y = THREE.MathUtils.lerp(standingY, seatedY, Math.min(1, e * 1.4));
      chair.position.copy(chairAt).addScaledVector(outward, pulled * (1 - e));
    }
    if (stage >= 4) {
      // Seated, however the clock got here: a page that stops drawing for a while (a hidden tab,
      // a busy browser) comes back with the clock past the sitting stage, which must not be skipped.
      sitOnce(avatar);
      avatar.root.position.copy(seat.position).setY(seatedY);
      chair.position.copy(chairAt);
    }
    const facing = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), avatar.root.rotation.y);
    // The camera: over your shoulder while you are on your feet, then into your eyes.
    if (stage < 4) {
      const head = avatar.root.position.clone().add(new THREE.Vector3(0, 1.45, 0));
      camera.position.copy(avatar.root.position).addScaledVector(facing, -2.3).add(new THREE.Vector3(0.45, 1.85, 0));
      camera.lookAt(head);
    } else {
      if (!cameraFrom) {
        cameraFrom = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
        rig.position.copy(seat.position);
        rig.rotation.y = seat.yaw;
        rig.updateMatrixWorld(true);
        seatedEye.copy(rig.worldToLocal(eyePosition(avatar)));
      }
      const eye = rig.localToWorld(seatedEye.clone());
      const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, seat.yaw, 0, "YXZ"));
      camera.position.lerpVectors(cameraFrom.position, eye, smooth(k));
      camera.quaternion.slerpQuaternions(cameraFrom.quaternion, look, smooth(k));
      // Gone before the camera reaches it: otherwise the last of the move is seen from inside the face.
      if (camera.position.distanceTo(eye) < 0.5) showOwnHead(avatar, false);
      if (k >= 1) {
        showOwnHead(avatar, false);
        rig.attach(camera);
        camera.position.copy(seatedEye);
        camera.rotation.set(-0.35, 0, 0, "YXZ");
        entrance = null;
        void sitDown();
      }
    }
  }

  /** Poses you seated, once: from where you stand in front of the pulled-out chair, facing the table. */
  function sitOnce(avatar: Avatar) {
    if (standingY) return;
    standingY = avatar.root.position.y || 0.001;
    avatar.root.position.copy(inFront);
    avatar.root.rotation.y = facingTable;
    poseSeated(avatar, 0.5);
    seatedY = avatar.root.position.y;
  }

  let view: TableView | null = null;
  async function sitDown() {
    // The referee is the compiled contract; its runtime's wasm must be up before it is imported.
    await runtimeReady;
    let referee: Referee & { start(): void | Promise<void> };
    if (entry.mode === "live") {
      const { LiveReferee } = await import("./live/referee.ts");
      const live = new LiveReferee(entry.chain, entry.seat, { store: entry.store });
      referee = live;
      const cashOut = document.createElement("button");
      cashOut.type = "button";
      cashOut.className = "leave";
      cashOut.title = "Finish any hand you are playing, then return your stack and bond to your wallet.";
      cashOut.onclick = () => live.cashOut();
      live.subscribe(() => {
        const state = live.cashOutState;
        cashOut.disabled = state !== "ready";
        cashOut.textContent = state === "waiting" ? "Cash-out pending" : state === "closed" ? "Seat closed" : "Cash out";
      });
      tableControls.append(cashOut);
    } else {
      const names = Array.from({ length: SEAT_COUNT }, (_, i) => (i === YOU ? profile.name : BOT_NAMES[(i + (i < YOU ? 0 : -1) + 5) % 5]!));
      const { ContractReferee } = await import("./referee/contract.ts");
      referee = new ContractReferee({ names, you: YOU });
    }
    const tableView = (view = new TableView(YOU, study));
    // A deal won: the pot slides to each winner, the dealer pushing it off and the winner drawing
    // it in; on a screen, the camera makes a film shot of it meanwhile.
    tableView.onAward = (piles, ms) => {
      const now = performance.now();
      pot = { start: now, ms, piles };
      for (const { seat } of piles) {
        manners[seat]?.busy(now + ms + 200);
      }
      if (renderer.xr.isPresenting) return;
      const winner = seatPose(piles[0]!.seat).position;
      const shot = SHOTS[Math.floor(Math.random() * SHOTS.length)]!;
      cinema.start(now, ms + 2200, shot, () => piles[0]!.pile.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.12, 0)), winner, DEALER_POSE.position);
    };
    const act = (a: Action) => referee.act(a).catch(console.warn);
    const show = () => referee.show().catch(console.warn);
    // Browser: the bar at the bottom of the page. Headset: the rail in front of the seat.
    const actionBar = new ActionBar(act, show);
    const hand = new HandPanel();
    document.body.append(actionBar.el, hand.el);
    // The hand panel sits just above the bar, whatever the bar's height is at this width.
    new ResizeObserver(() => (hand.el.style.bottom = `${actionBar.el.offsetHeight + 10}px`)).observe(actionBar.el);
    const rail = new Rail(YOU, act, show, controls.register);
    rail.group.visible = false;
    const inXR = () => {
      rail.group.visible = renderer.xr.isPresenting;
      actionBar.el.hidden = renderer.xr.isPresenting;
      hand.el.hidden = renderer.xr.isPresenting;
    };
    renderer.xr.addEventListener("sessionstart", inXR);
    renderer.xr.addEventListener("sessionstart", () => cinema.end()); // the headset is the camera now
    renderer.xr.addEventListener("sessionend", inXR);
    scene.add(tableView.group, rail.group);
    attachCards = (i, avatar) => {
      const lift = i === YOU ? LIFT : 0;
      tableView.attachHoleCards(i, cardAnchor(avatar, lift));
      // From here on the seat's manner (scene/manner.ts) handles its cards and arms.
      manners[i] = new Manner(avatar, i, tableView, i === YOU);
    };
    avatars.forEach((a, i) => a && attachCards!(i, a));
    onSelect = rail.onSelect;
    referee.subscribe((s) => {
      tableView.update(s);
      rail.update(s);
      actionBar.update(s);
      hand.update(s);
      // Empty seats have no one in them: a Live table fills as players join.
      avatars.forEach((a, i) => i !== YOU && i < SEAT_COUNT && a && (a.root.visible = s.seats[i]!.name !== null));
      (window as unknown as Record<string, unknown>).__table = s; // inspection handle, like __scene
      react(s);
      tableState = s;
    });
    Object.assign(window as unknown as Record<string, unknown>, { __referee: referee });
    void Promise.resolve(referee.start()).catch(console.error);
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
    fx?.setSize(window.innerWidth, window.innerHeight);
  }

  // Ambient occlusion and the rest run outside XR only: presenting, three renders each eye itself.
  // The film shot at a deal's end; your head shows while the camera is out of it.
  const cinema = new Cinema(scene, camera, rig, (out) => {
    const me = avatars[YOU];
    if (me) showOwnHead(me, out);
  });
  const fx: Fx | null = fxOn() ? postprocessing(renderer, scene, camera) : null;
  renderer.setAnimationLoop((now) => {
    stats.frames++;
    fitViewport();
    view?.animate(now);
    entranceFrame(now);
    cinema.frame(now);
    for (const m of manners) m?.update(now, tableState);
    dealerFrame(now);
    const heads = avatars.map((a) => (a?.root.visible ? headOf(a) : null));
    const moved = [...lives].filter(([a]) => a.root.visible);
    for (const [a, life] of moved) life.apply(now, attention(a, heads));
    if (fx && !renderer.xr.isPresenting) fx.render();
    else renderer.render(scene, camera);
    for (const [, life] of moved) life.restore();
  });

  /** How far the dealer's right hand is up over the deck: up while he deals, down at his side otherwise. */
  let dealerUp = 0;
  let dealerLast = 0;
  /** The dealer's right hand this frame: over the deck while cards fly, out after the pot, else at rest. */
  function dealerFrame(now: number) {
    const dt = Math.min(0.1, dealerLast ? (now - dealerLast) / 1000 : 0);
    dealerLast = now;
    dealerUp += ((view?.dealing ? 1 : 0) - dealerUp) * (1 - Math.exp(-8 * dt));
    const target = potFrame(now);
    if (dealerAvatar) dealerReach(dealerAvatar, target, dealerUp);
  }

  /** The pot's journey this frame: the winners' hands round it, and where the dealer's hand goes after it, if anywhere. */
  function potFrame(now: number): THREE.Vector3 | null {
    if (!pot) return null;
    const t = (now - pot.start) / pot.ms;
    if (t >= 1) {
      pot = null;
      return null;
    }
    for (const { seat, pile } of pot.piles) {
      const a = avatars[seat];
      if (a && t > 0.42) drawIn(a, pile.getWorldPosition(new THREE.Vector3()));
    }
    return t > 0.18 && t < 0.6 ? pot.piles[0]!.pile.getWorldPosition(new THREE.Vector3()) : null;
  }

  function headOf(a: Avatar): THREE.Vector3 {
    return (a.bones.get("Bip01 Head") ?? a.root).getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.08, 0));
  }

  /** Where `a` may look: at whoever is to act, the dealer's hands while cards go out, the winner after; or a neighbour. */
  function attention(a: Avatar, heads: (THREE.Vector3 | null)[]): Attention {
    const seat = avatars.indexOf(a);
    const others = heads.filter((h, i): h is THREE.Vector3 => !!h && i !== seat);
    if (dealerAvatar && a !== dealerAvatar) others.push(headOf(dealerAvatar));
    let focus: THREE.Vector3 | null = null;
    if (tableState?.toAct != null) focus = heads[tableState.toAct] ?? null;
    else if (tableState?.street === "between") focus = heads[tableState.seats.findIndex((x) => x.isWinner)] ?? null;
    if (!focus && dealerAvatar) focus = dealerAvatar.hand("R").getWorldPosition(new THREE.Vector3());
    // Out of the hand and holding nothing: folded, or between deals. The staff are always at work.
    const me = seat >= 0 ? tableState?.seats[seat] : undefined;
    const idle = !!me && !!manners[seat]?.idle;
    return { focus, others, deciding: seat >= 0 && tableState?.toAct === seat, idle, handsPlanted: manners[seat]?.handsPlanted };
  }

  /** A smile for the winners when a deal ends, a frown for those who lost at the showdown or folded. */
  let reactedTo = "";
  function react(s: TableState) {
    const now = performance.now();
    s.seats.forEach((seat, i) => {
      const a = avatars[i];
      const folding = seat.folded && tableState && !tableState.seats[i]!.folded;
      if (a && folding) lives.get(a)?.react("lose", now);
    });
    if (s.street !== "between" || !s.seats.some((x) => x.isWinner) || s.message === reactedTo) return;
    reactedTo = s.message;
    s.seats.forEach((seat, i) => {
      const a = avatars[i];
      if (a && seat.name !== null && (seat.isWinner || seat.inHand)) lives.get(a)?.react(seat.isWinner ? "win" : "lose", now);
    });
  }
}
