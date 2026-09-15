import * as THREE from "three";

export const SHIRT_COLORS = [0xc8102e, 0x1e6f9f, 0xd4a017, 0x2e8b57, 0x8e44ad, 0xe07b39];

// One geometry and material per part, shared by every seat.
const cushionGeometry = new THREE.BoxGeometry(0.5, 0.1, 0.5);
const backGeometry = new THREE.BoxGeometry(0.5, 0.55, 0.08);
const postGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 12);
const torsoGeometry = new THREE.CapsuleGeometry(0.17, 0.35, 4, 12);
const headGeometry = new THREE.SphereGeometry(0.11, 24, 16);
const leather = new THREE.MeshStandardMaterial({ color: 0x5a1a1a, roughness: 0.6 });
const brass = new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 0.8, roughness: 0.3 });
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
  back.position.set(0, 0.75, 0.24);
  g.add(back);
  const post = new THREE.Mesh(postGeometry, brass);
  post.position.y = 0.2;
  g.add(post);

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
