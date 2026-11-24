import { expect, spyOn, test } from "bun:test";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { emptyTable } from "../referee/rules.ts";
import { type Avatar, cardAnchor, dealerReach, holdCards, loadAvatar, poseDealer, poseHands, poseSeated } from "./avatars.ts";
import { CARD_H, CARD_W } from "./cards.ts";
import { Life } from "./life.ts";
import { Manner } from "./manner.ts";
import { MODELS, STAFF } from "./models.ts";
import { FELT_TOP, RAIL_RADIUS, RAIL_TOP, TABLE_RADIUS, seatPose } from "./table.ts";
import { HAND_APPROACH_MS, TableView } from "./table-view.ts";

// Load the shipped rigs and morphs without a browser image decoder.
const geometryLoader = new GLTFLoader().register(parser => ({
  name: "geometry-only",
  loadMaterial: async i => new THREE.MeshStandardMaterial({ name: parser.json.materials[i].name }),
}));
const loadFiles = () => spyOn(GLTFLoader.prototype, "loadAsync").mockImplementation(async (url) =>
  geometryLoader.parseAsync(await Bun.file(url).arrayBuffer(), ""));

function tableView(you: number) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const context = { clearRect() {}, fillRect() {}, fillText() {}, measureText: () => ({ width: 9 }) };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => ({ getContext: () => context }) } });
  try {
    return new TableView(you, { cardBack: new THREE.MeshLambertMaterial() });
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

function pads(avatar: Avatar, card: THREE.Object3D, side: "L" | "R") {
  return ["0", "1"].map(digit => {
    const distal = avatar.bones.get(`Bip01 ${side} Finger${digit}2`)!;
    return card.worldToLocal(distal.localToWorld(new THREE.Vector3(0, distal.position.length() * 0.7, 0)));
  });
}

function handVertices(a: Avatar) {
  const vertices: { mesh: THREE.SkinnedMesh; index: number; joint: string }[] = [];
  a.root.traverse(mesh => {
    if (!(mesh instanceof THREE.SkinnedMesh) || Array.isArray(mesh.material) || !mesh.material.name.endsWith("_skin")) return;
    const g = mesh.geometry;
    for (let index = 0; index < g.attributes.position!.count; index++) {
      const joint = mesh.skeleton.bones[g.attributes.skinIndex!.getX(index)]!.name;
      if (/_(Hand|Finger)/.test(joint) && g.attributes.skinWeight!.getX(index) >= 0.45) vertices.push({ mesh, index, joint });
    }
  });
  return vertices;
}

function expectGrip(a: Avatar, cards: THREE.Object3D[]) {
  for (const [k, side] of (["L", "R"] as const).entries()) {
    const [thumb, index] = pads(a, cards[k]!, side);
    for (const pad of [thumb!, index!]) {
      expect(pad.x * (k ? 1 : -1)).toBeWithin(CARD_W / 2 - 0.012, CARD_W / 2);
      expect(pad.y).toBeWithin(-0.026, -0.015);
    }
    expect(thumb!.z).toBeWithin(0.002, 0.012);
    expect(index!.z).toBeWithin(-0.012, -0.002);
  }
}

test("every build opposes the thumb and index on its own card after resting, at both profile height limits", async () => {
  const files = loadFiles();
  try {
    for (const [i, model] of MODELS.entries()) {
      for (const height of [0.92, 1.08]) {
        const a = await loadAvatar(model.url), seat = i % 6, view = tableView(seat);
        const { position, yaw } = seatPose(seat);
        a.root.position.copy(position);
        a.root.rotation.y = yaw + Math.PI;
        a.root.scale.setScalar(height);
        poseSeated(a);
        view.attachHoleCards(seat, cardAnchor(a, height < 1 ? 0 : 0.05));
        const cards = view.handTargets(seat);
        expect(cards[0]!.getWorldScale(new THREE.Vector3()).x).toBeCloseTo(1, 6);
        const life = new Life(a, { seed: i });
        let now = 1000;
        for (const rest of ["rail", "cover", "crossed", "lap"] as const) {
          poseHands(a, rest, view.cardSpot(seat, 1));
          holdCards(a, cards);
          const attention = { focus: seatPose((seat + 2) % 6).position, others: [], deciding: true, handsPlanted: true };
          life.apply(now, attention);
          life.restore();
          life.apply(now + 100, attention);
          expectGrip(a, cards);
          life.restore();
          now += 200;
        }
      }
    }
  } finally {
    files.mockRestore();
  }
});

test("hands follow a transfer, reverse on a turn change, and leave a revealed opponent's cards face up", async () => {
  const files = loadFiles();
  try {
    const seat = 1, a = await loadAvatar(MODELS[0]!.url), view = tableView(0);
    const { position, yaw } = seatPose(seat);
    a.root.position.copy(position);
    a.root.rotation.y = yaw + Math.PI;
    poseSeated(a);
    view.attachHoleCards(seat, cardAnchor(a));
    const manner = new Manner(a, seat, view, false);
    const state = emptyTable(["You", "Player", null, null, null, null], 0);
    const me = state.seats[seat]!;
    me.inHand = true;
    state.street = "flop";
    state.toAct = seat;
    view.update(state);
    const frame = (now: number) => { view.animate(now); manner.update(now, state); };
    frame(1000);
    expectGrip(a, view.handTargets(seat));
    // A finished deal puts the unknown cards down; sample both hands while the cards travel.
    state.street = "between";
    me.isWinner = true;
    state.toAct = null;
    frame(1500);
    frame(1650);
    expect(view.movingCards(seat)).toBe(true);
    expectGrip(a, view.handTargets(seat));
    // A new turn interrupts the putdown without teleporting the cards.
    const before = view.handTargets(seat).map(c => c.getWorldPosition(new THREE.Vector3()));
    state.street = "turn";
    me.isWinner = false;
    state.toAct = seat;
    frame(1650);
    view.handTargets(seat).forEach((c, i) => expect(c.getWorldPosition(new THREE.Vector3()).distanceTo(before[i]!)).toBeLessThan(1e-6));
    frame(2500);
    expectGrip(a, view.handTargets(seat));
    state.street = "between";
    me.isWinner = true;
    state.toAct = null;
    frame(2600);
    frame(3300);
    expect(view.handTargets(seat)[0]!.getWorldDirection(new THREE.Vector3()).y).toBeLessThan(-0.99);
    state.street = "turn";
    me.isWinner = false;
    state.toAct = seat;
    frame(3310);
    expect(view.movingCards(seat)).toBe(true);
    state.street = "between";
    me.isWinner = true;
    state.toAct = null;
    frame(3340);
    expect(view.movingCards(seat)).toBe(false);
    me.hole = ["As", "Kd"];
    frame(3350);
    frame(4100);
    expect(view.handTargets(seat)[0]!.getWorldDirection(new THREE.Vector3()).y).toBeGreaterThan(0.99);
    expect(view.isDown(seat)).toBe(true);
    // On the next deal the hands wait at the catching position as both cards fly from the dealer.
    const dealt = view.handTargets(seat);
    me.hole = null;
    me.isWinner = false;
    state.street = "preflop";
    state.toAct = seat;
    view.update(state);
    const now = performance.now();
    frame(now);
    frame(now + HAND_APPROACH_MS);
    const slots = view.handTargets(seat);
    expect(view.dealing).toBe(true);
    expect(slots[0]!.getWorldPosition(new THREE.Vector3()).distanceTo(dealt[0]!.getWorldPosition(new THREE.Vector3()))).toBeGreaterThan(0.5);
    expectGrip(a, slots);
    frame(now + 1000);
    expect(view.dealing).toBe(false);
    expectGrip(a, dealt);
  } finally {
    files.mockRestore();
  }
});

test("the skin of a resting hand clears the padded rail and touches the back of the guarded card", async () => {
  const files = loadFiles();
  try {
    for (const [i, model] of MODELS.entries()) {
      for (const height of [0.92, 1.08]) {
        const a = await loadAvatar(model.url);
        const seat = i % 6, { position, yaw } = seatPose(seat);
        a.root.position.copy(position);
        a.root.rotation.y = yaw + Math.PI;
        a.root.scale.setScalar(height);
        poseSeated(a);
        const spot = TableView.prototype.cardSpot(seat, 1);
        poseHands(a, "cover", spot);
        a.root.updateMatrixWorld(true);
        let clearance = Infinity, contact = Infinity;
        const v = new THREE.Vector3(), cardLocal = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
        for (const { mesh, index, joint } of handVertices(a)) {
          mesh.getVertexPosition(index, v).applyMatrix4(mesh.matrixWorld);
          const radius = Math.hypot(v.x, v.z);
          const t = (radius - RAIL_RADIUS) / 0.08;
          const top = Math.abs(t) < 1 ? RAIL_TOP - 0.0576 * (1 - Math.sqrt(1 - t * t)) : radius < TABLE_RADIUS ? FELT_TOP : -Infinity;
          clearance = Math.min(clearance, v.y - top);
          cardLocal.copy(v).sub(spot).applyAxisAngle(up, -(yaw + 0.07));
          if (joint.includes("_R_Finger") && Math.abs(cardLocal.x) < CARD_W / 2 && Math.abs(cardLocal.z) < CARD_H / 2) {
            contact = Math.min(contact, Math.abs(cardLocal.y));
          }
        }
        expect(clearance).toBeGreaterThan(-0.001);
        expect(contact).toBeLessThan(0.006);
      }
    }
  } finally {
    files.mockRestore();
  }
});

test("resting opponents clear the rail when tucking their arms and reaching back for their cards", async () => {
  const files = loadFiles();
  try {
    // With the seat's usual random seed these players cross their arms and rest in their lap.
    for (const seat of [3, 4]) {
      const a = await loadAvatar(MODELS[seat]!.url), view = tableView(0);
      const { position, yaw } = seatPose(seat);
      a.root.position.copy(position);
      a.root.rotation.y = yaw + Math.PI;
      poseSeated(a);
      view.attachHoleCards(seat, cardAnchor(a));
      const manner = new Manner(a, seat, view, false);
      const state = emptyTable(["You", null, null, "Ella", "Dean", null], 0);
      state.street = "flop";
      state.seats[seat]!.inHand = true;
      view.update(state);
      const vertices = handVertices(a), v = new THREE.Vector3();
      let closest = Infinity;
      for (let now = 1000; now <= 9200; now += 20) {
        state.toAct = now < 1100 || now >= 8000 ? seat : null;
        view.animate(now);
        manner.update(now, state);
        if (now === 7900) {
          expect(manner.handsPlanted).toBe(false);
          expect(view.isDown(seat)).toBe(true);
        }
        a.root.updateMatrixWorld(true);
        for (const { mesh, index } of vertices) {
          mesh.getVertexPosition(index, v).applyMatrix4(mesh.matrixWorld);
          // Unit ellipse in the cross-section of the padded torus, including its underside.
          closest = Math.min(closest, Math.hypot((Math.hypot(v.x, v.z) - RAIL_RADIUS) / 0.08, (v.y - RAIL_TOP + 0.0576) / 0.0576));
        }
      }
      expect(closest).toBeGreaterThan(1);
      expectGrip(a, view.handTargets(seat));
    }
  } finally {
    files.mockRestore();
  }
});

test("the cast's culling bounds enclose every weighted vertex through joint rotations and facial expressions", async () => {
  const files = loadFiles();
  try {
    for (const url of [...MODELS.map((m) => m.url), ...Object.values(STAFF)]) {
      const { root, bones } = await loadAvatar(url);
      const hips = bones.get("Bip01 Pelvis")!;
      const centre = hips.getWorldPosition(new THREE.Vector3());
      root.traverse((part) => {
        if (!(part instanceof THREE.SkinnedMesh)) return;
        expect(part.frustumCulled).toBe(true);
        const bounds = part.boundingSphere!.clone().applyMatrix4(part.matrixWorld);
        expect(bounds.center.distanceTo(centre)).toBeLessThan(1e-5);
        const g = part.geometry;
        const pivots = part.skeleton.bones.map((b) => b.getWorldPosition(new THREE.Vector3()));
        const reach = part.skeleton.bones.map((bone) => {
          // A rotating chain can extend at most the sum of its link lengths.
          let joint: THREE.Object3D = bone;
          let length = 0;
          while (joint !== hips && joint.parent && joint !== hips.parent) {
            length += joint.position.length();
            joint = joint.parent;
          }
          return length + (joint === hips ? 0 : joint.getWorldPosition(new THREE.Vector3()).distanceTo(centre));
        });
        const position = g.getAttribute("position"), joints = g.getAttribute("skinIndex"), weights = g.getAttribute("skinWeight");
        const vertex = new THREE.Vector3(), delta = new THREE.Vector3();
        let furthest = 0;
        for (let i = 0; i < position.count; i++) {
          vertex.fromBufferAttribute(position, i).applyMatrix4(part.matrixWorld);
          let distance = 0;
          for (let k = 0; k < 4; k++) {
            const j = joints.getComponent(i, k);
            distance += weights.getComponent(i, k) * (reach[j]! + pivots[j]!.distanceTo(vertex));
          }
          for (const shape of g.morphAttributes.position ?? []) distance += delta.fromBufferAttribute(shape, i).length();
          furthest = Math.max(furthest, distance);
        }
        expect(furthest).toBeLessThan(bounds.radius);
      });
    }
  } finally {
    files.mockRestore();
  }
});

test("aiming the dealer's arm and gaze updates the required bones without walking unrelated meshes", async () => {
  const files = loadFiles();
  try {
    const dealer = await loadAvatar(STAFF.dealer);
    poseDealer(dealer);
    const life = new Life(dealer, { seed: 11, standing: true });
    const update = spyOn(dealer.mesh, "updateMatrixWorld");
    const before = dealer.hand("R").getWorldPosition(new THREE.Vector3());
    const focus = new THREE.Vector3(0, 1, 1);
    dealerReach(dealer, focus);
    life.apply(1000, { focus, others: [], deciding: false });
    expect(dealer.hand("R").getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeGreaterThan(0.1);
    expect(update).not.toHaveBeenCalled();
    life.restore();
  } finally {
    files.mockRestore();
  }
});
