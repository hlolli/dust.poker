import * as THREE from "three";

/**
 * Desktop mouse-look for a seated camera, plus one click/select path that works
 * for the mouse and for XR controllers alike. The camera lives inside a rig group;
 * we rotate the camera, never the rig, so the seat keeps facing the table.
 */
export function attachControls(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  rig: THREE.Group,
  onSelect: (hit: THREE.Object3D) => void,
) {
  const interactables: THREE.Object3D[] = [];
  const raycaster = new THREE.Raycaster();
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const el = renderer.domElement;

  let dragging = false;
  let moved = 0;
  el.addEventListener("pointerdown", (e) => {
    dragging = true;
    moved = 0;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= e.movementX * 0.003;
    euler.x = THREE.MathUtils.clamp(euler.x - e.movementY * 0.003, -1.2, 1.2);
    camera.quaternion.setFromEuler(euler);
  });
  el.addEventListener("pointerup", (e) => {
    dragging = false;
    if (moved > 6) return; // it was a look, not a click
    const ndc = new THREE.Vector2((e.clientX / el.clientWidth) * 2 - 1, -(e.clientY / el.clientHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    fire();
  });

  // XR: a ray from each controller on select.
  for (const i of [0, 1]) {
    const c = renderer.xr.getController(i);
    c.addEventListener("selectstart", () => {
      raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).transformDirection(c.matrixWorld);
      fire();
    });
    rig.add(c);
  }

  function fire() {
    const hit = raycaster.intersectObjects(interactables, false)[0];
    if (hit) onSelect(hit.object);
  }

  return {
    register(o: THREE.Object3D) {
      interactables.push(o);
    },
    unregister(o: THREE.Object3D) {
      const i = interactables.indexOf(o);
      if (i >= 0) interactables.splice(i, 1);
    },
  };
}
