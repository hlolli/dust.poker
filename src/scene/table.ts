import * as THREE from "three";
import { darkWood, velvet } from "./materials.ts";

export const SEAT_COUNT = 6;
export const TABLE_RADIUS = 1.1;
/** Distance from table centre to where a seated body sits. */
export const SEAT_RADIUS = 1.6;
/** Eye height of a seated adult; XR headsets override it. */
export const EYE_HEIGHT = 1.2;

/** Seat i sits on a circle around the table, facing the centre. Seat 0 is at +z. */
export function seatPose(i: number): { position: THREE.Vector3; yaw: number } {
  const a = (i / SEAT_COUNT) * Math.PI * 2;
  return {
    position: new THREE.Vector3(Math.sin(a) * SEAT_RADIUS, 0, Math.cos(a) * SEAT_RADIUS),
    // Facing the centre: the default look direction is -z, rotating it by `a`
    // gives (-sin a, -cos a), which points from the seat to the centre.
    yaw: a,
  };
}

/** The dealer stands at the rail between seats 3 and 4, across from seat 0, facing the centre. */
export const DEALER_POSE = (() => {
  const a = (3.5 / SEAT_COUNT) * Math.PI * 2;
  const r = TABLE_RADIUS + 0.35;
  return { position: new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r), yaw: a };
})();

export function createTable(): THREE.Group {
  const g = new THREE.Group();
  g.name = "table";
  const felt = velvet(0x0f4a34, 4);
  const wood = darkWood(2);

  const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.06, 64), felt);
  top.position.y = 0.75;
  g.add(top);

  const rail = new THREE.Mesh(new THREE.TorusGeometry(TABLE_RADIUS + 0.04, 0.08, 16, 96), wood);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = 0.78;
  g.add(rail);

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.72, 24), wood);
  pedestal.position.y = 0.36;
  g.add(pedestal);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.65, 0.04, 32), wood);
  base.position.y = 0.02;
  g.add(base);

  return g;
}
