import { expect, test } from "bun:test";
import * as THREE from "three";
import { SEAT_COUNT, seatPose } from "./table.ts";

test("every seat faces the centre of the table", () => {
  for (let i = 0; i < SEAT_COUNT; i++) {
    const { position, yaw } = seatPose(i);
    const look = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const reached = position.clone().addScaledVector(look, position.length());
    expect(reached.length()).toBeLessThan(1e-9);
  }
});
