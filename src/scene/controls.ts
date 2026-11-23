import * as THREE from "three";

/** Hidden rail buttons cannot take a click. Distant props also need a clear line of sight. */
export function pickControl(ray: THREE.Raycaster, targets: ReadonlyMap<THREE.Object3D, THREE.Scene | undefined>) {
  const visible: THREE.Object3D[] = [];
  for (const target of targets.keys()) {
    let ancestor: THREE.Object3D | null = target;
    while (ancestor?.visible) ancestor = ancestor.parent;
    if (!ancestor) visible.push(target);
  }
  const hit = ray.intersectObjects(visible, false)[0];
  if (!hit) return;
  const scene = targets.get(hit.object);
  if (scene) {
    const solid: THREE.Mesh[] = [];
    scene.traverseVisible(o => {
      if (o instanceof THREE.Mesh && (Array.isArray(o.material) || !o.material.transparent)) solid.push(o);
    });
    const nearest = ray.intersectObjects(solid, false)[0];
    if (nearest && nearest.distance < hit.distance - 0.001) return;
  }
  return hit.object;
}

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
  const interactables = new Map<THREE.Object3D, THREE.Scene | undefined>();
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
    const hit = pickControl(raycaster, interactables);
    if (hit) onSelect(hit);
  }

  return {
    register(o: THREE.Object3D, occlusionScene?: THREE.Scene) {
      interactables.set(o, occlusionScene);
    },
    unregister(o: THREE.Object3D) {
      interactables.delete(o);
    },
  };
}
