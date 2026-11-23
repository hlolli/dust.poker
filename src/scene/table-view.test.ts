import { expect, test } from "bun:test";
import * as THREE from "three";
import { CARD_W, CardMesh } from "./cards.ts";
import { SEAT_COUNT, TABLE_RADIUS } from "./table.ts";
import { TableView } from "./table-view.ts";

test("every seat can lay two separate cards just above the felt", () => {
  for (let seat = 0; seat < SEAT_COUNT; seat++) {
    const left = TableView.prototype.cardSpot(seat, 0);
    const right = TableView.prototype.cardSpot(seat, 1);
    for (const p of [left, right]) {
      expect(p.y).toBeGreaterThan(0.78);
      expect(p.y).toBeLessThan(0.79);
      expect(Math.hypot(p.x, p.z)).toBeLessThan(TABLE_RADIUS);
    }
    expect(Math.hypot(left.x - right.x, left.z - right.z)).toBeGreaterThan(CARD_W);
    expect(left.clone().lerp(right, 0.5).distanceTo(TableView.prototype.cardSpot(seat))).toBeLessThan(1e-9);
  }
});

test("concealing a card restores the same house back on both sides", () => {
  const back = new THREE.MeshLambertMaterial();
  const card = new CardMesh(back);
  const [front, reverse] = card.mesh.children as THREE.Mesh[];
  front!.material = new THREE.MeshLambertMaterial();
  card.show("back");
  expect(card.mesh.visible).toBe(true);
  expect(front!.material).toBe(back);
  expect(reverse!.material).toBe(back);
  card.show(null);
  expect(card.mesh.visible).toBe(false);
});
