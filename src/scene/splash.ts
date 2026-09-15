import * as THREE from "three";
import { brass, marbleBlack } from "./materials.ts";
import { ROOM } from "./room.ts";
import { textPlane } from "./text.ts";

/** The hotel's sign on the far wall in gold lettering, and the one door in the menu: the Practice table. */
export function createSplash(): { group: THREE.Group; practiceDoor: THREE.Mesh } {
  const g = new THREE.Group();
  g.name = "splash";
  const wallZ = -ROOM.depth / 2 + 0.12;

  // A black marble panel with the name in gold, set under the far arch.
  const panel = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.5, 0.12), Object.assign(marbleBlack(1), { color: new THREE.Color(0x151515) }));
  panel.position.set(0, 5.6, wallZ);
  g.add(panel);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.7, 0.06), brass());
  frame.position.set(0, 5.6, wallZ - 0.04);
  g.add(frame);
  const sign = textPlane("dust.poker", { width: 4.8, color: "#e8c56a", font: "italic 150px Georgia, 'Times New Roman', serif" });
  sign.position.set(0, 5.6, wallZ + 0.07);
  g.add(sign);

  // The door: a brass plaque floating between the player and the table.
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

  const plaqueFrame = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.3, 0.03), brass());
  plaqueFrame.position.set(0, 0.95, 2.38);
  plaqueFrame.rotation.x = -0.25;
  g.add(plaqueFrame);

  return { group: g, practiceDoor };
}
