import { expect, test } from "bun:test";
import * as THREE from "three";
import { pickControl } from "./controls.ts";

test("a cabinet behind the XR rail can be selected only when visible from the seat", () => {
  const scene = new THREE.Scene();
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry());
  cabinet.position.z = -4;
  const rail = new THREE.Group();
  const button = new THREE.Mesh(new THREE.PlaneGeometry());
  rail.position.z = -1;
  rail.add(button);
  const column = new THREE.Mesh(new THREE.BoxGeometry());
  column.position.z = -2;
  scene.add(cabinet, rail, column);
  scene.updateMatrixWorld();

  const targets = new Map<THREE.Object3D, THREE.Scene | undefined>([[cabinet, scene], [button, undefined]]);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  expect(pickControl(ray, targets)).toBe(button);
  rail.visible = false;
  expect(pickControl(ray, targets)).toBeUndefined();
  column.visible = false;
  expect(pickControl(ray, targets)).toBe(cabinet);
  cabinet.visible = false;
  expect(pickControl(ray, targets)).toBeUndefined();
});
