import * as THREE from "three";
import { brass, darkWood, felt, railLeather } from "./materials.ts";

export const SEAT_COUNT = 6;
export const TABLE_RADIUS = 1.1;
export const FELT_TOP = 0.78;
/** Distance from table centre to where a seated body sits. */
export const SEAT_RADIUS = 1.6;
/** Eye height of a seated adult; XR headsets override it. */
export const EYE_HEIGHT = 1.2;
/** The padded rail round the felt: the middle of its tube from the table's centre, and the top of it. */
export const RAIL_RADIUS = TABLE_RADIUS + 0.04;
export const RAIL_TOP = 0.86;

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
  const baize = felt(0x0a4d33); // casino green: under the warm lamp a greyer green reads olive
  const wood = darkWood(2);

  const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.06, 64), baize);
  top.position.y = FELT_TOP - 0.03;
  g.add(top);

  // Wrap the grain to scale around the whole rail. A single trip around the torus
  // is much longer than a trip around its padded cross-section.
  const cushion = new THREE.TorusGeometry(RAIL_RADIUS, 0.08, 16, 96);
  const uv = cushion.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 14);
  const rail = new THREE.Mesh(cushion, railLeather());
  rail.rotation.x = Math.PI / 2;
  rail.scale.z = 0.72;
  rail.position.y = RAIL_TOP - 0.08 * rail.scale.z;
  g.add(rail);

  const apron = new THREE.Mesh(new THREE.CylinderGeometry(RAIL_RADIUS + 0.025, RAIL_RADIUS, 0.09, 96), wood);
  apron.position.y = 0.707;
  g.add(apron);
  const beading = new THREE.Mesh(new THREE.TorusGeometry(RAIL_RADIUS + 0.006, 0.004, 8, 96), brass());
  beading.rotation.x = Math.PI / 2;
  beading.position.y = 0.679;
  g.add(beading);

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.72, 24), wood);
  pedestal.position.y = 0.36;
  g.add(pedestal);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.65, 0.04, 32), wood);
  base.position.y = 0.02;
  g.add(base);

  return g;
}
