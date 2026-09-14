import * as THREE from "three";

// ponytail: bare room; the casino comes later.
export function createRoom(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1a1c);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x2a1a0e }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 0.05, 48),
    new THREE.MeshStandardMaterial({ color: 0x0f5f3f }),
  );
  table.position.set(0, 0.75, -1.2);
  scene.add(table);

  scene.add(new THREE.HemisphereLight(0xffe9c4, 0x1a0f08, 1.2));
  return scene;
}
