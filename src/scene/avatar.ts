import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { brass as brassMaterial, leather as leatherMaterial } from "./materials.ts";

/**
 * A tub chair's back: a band of the circle round the seat, 100 degrees of it, standing up from
 * the cushion. Its inner face is where the old flat back's was (20 cm behind the seat's centre),
 * so the seated poses still lean against it; the sides curve forward no wider than a torso.
 */
function tubBack(): THREE.BufferGeometry {
  const centre = 0.06; // the arcs' centre sits 6 cm in front of the seat's centre
  const [inner, outer] = [0.26, 0.31];
  const span = (100 * Math.PI) / 180;
  // Drawn in the XY plane with the back towards -y, then stood up: y becomes -z, the extrusion +y.
  const [a0, a1] = [-Math.PI / 2 - span / 2, -Math.PI / 2 + span / 2];
  const shape = new THREE.Shape();
  shape.absarc(0, centre, outer, a0, a1, false);
  shape.absarc(0, centre, inner, a1, a0, true);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.5, curveSegments: 24, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 3 });
  g.rotateX(-Math.PI / 2);
  return g;
}

// One geometry and material per part, shared by every seat.
const cushionGeometry = new RoundedBoxGeometry(0.5, 0.1, 0.5, 3, 0.035);
const backGeometry = tubBack();
const postGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 12);
const footGeometry = new THREE.CylinderGeometry(0.21, 0.24, 0.03, 32);
const torsoGeometry = new THREE.CapsuleGeometry(0.17, 0.35, 4, 12);
const headGeometry = new THREE.SphereGeometry(0.11, 24, 16);
const leather = leatherMaterial(1);
const brass = brassMaterial();
const skin = new THREE.MeshStandardMaterial({ color: 0xd9a77c, roughness: 0.7 });
const shirts = new Map<number, THREE.MeshStandardMaterial>();
const shirt = (color: number) => {
  let m = shirts.get(color);
  if (!m) shirts.set(color, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.8 })));
  return m;
};

/** A chair, optionally with a seated figure in it. Faces -z; place with seatPose(). */
export function createSeat(shirtColor: number | null): THREE.Group {
  const g = new THREE.Group();
  g.name = shirtColor === null ? "seat" : "seat-with-bot";

  const cushion = new THREE.Mesh(cushionGeometry, leather);
  cushion.position.y = 0.45;
  g.add(cushion);
  const back = new THREE.Mesh(backGeometry, leather);
  back.position.y = 0.48; // from the cushion's top to a little over a metre
  g.add(back);
  const post = new THREE.Mesh(postGeometry, brass);
  post.position.y = 0.2;
  g.add(post);
  const foot = new THREE.Mesh(footGeometry, brass);
  foot.position.y = 0.015;
  g.add(foot);

  if (shirtColor !== null) {
    // ponytail: capsule and a sphere. Presets and real heads come with presence.
    const torso = new THREE.Mesh(torsoGeometry, shirt(shirtColor));
    torso.position.set(0, 0.82, 0.02);
    g.add(torso);
    const head = new THREE.Mesh(headGeometry, skin);
    head.position.set(0, 1.24, 0);
    g.add(head);
  }
  return g;
}
