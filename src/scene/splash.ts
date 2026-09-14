import * as THREE from "three";
import { ROOM } from "./room.ts";
import { textPlane } from "./text.ts";

/** Neon sign on the far wall and the one door in the menu: the Practice table. */
export function createSplash(): { group: THREE.Group; practiceDoor: THREE.Mesh } {
  const g = new THREE.Group();
  const wallZ = -ROOM.depth / 2 + 0.05;

  const sign = textPlane("dust.poker", { width: 5, color: "#ffd1ec", glow: "#ff2d95" });
  sign.position.set(0, 2.6, wallZ);
  g.add(sign);

  // Teal neon tube framing the sign.
  const tube = new THREE.Mesh(
    new THREE.TorusGeometry(2.4, 0.025, 8, 64, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x9ffcf0, emissive: 0x19e6d0, emissiveIntensity: 3 }),
  );
  tube.position.set(0, 2.3, wallZ);
  g.add(tube);

  const pink = new THREE.PointLight(0xff2d95, 25, 8, 2);
  pink.position.set(0, 2.6, wallZ + 0.6);
  g.add(pink);
  const teal = new THREE.PointLight(0x19e6d0, 10, 6, 2);
  teal.position.set(0, 1.6, wallZ + 0.6);
  g.add(teal);

  // The door: a brass plaque floating between the player and the table.
  // Sits below the sightline to the table, like a lectern plaque.
  const practiceDoor = textPlane("PRACTICE TABLE", {
    width: 0.9,
    font: "bold 110px Georgia, serif",
    color: "#2a1a08",
    background: "#c9a24a",
  });
  practiceDoor.position.set(0, 0.95, 2.4);
  practiceDoor.rotation.x = -0.25;
  practiceDoor.name = "practice-door";
  g.add(practiceDoor);

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(0.98, 0.3, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x3a1f0f, roughness: 0.5 }),
  );
  frame.position.set(0, 0.95, 2.38); // just behind the plaque
  frame.rotation.x = -0.25;
  g.add(frame);

  return { group: g, practiceDoor };
}
