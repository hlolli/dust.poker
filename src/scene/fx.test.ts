import { expect, spyOn, test } from "bun:test";
import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { postprocessing, useDiffuseLighting } from "./fx.ts";

test("low-detail lighting keeps cutout textures shared and leaves glass and illuminated signs intact", () => {
  const hair = new THREE.MeshStandardMaterial({ name: "dealer_opacity", map: new THREE.Texture(), alphaTest: 0.35, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 });
  const sign = new THREE.MeshStandardMaterial({ emissive: 0xffaa44 });
  const shapes = [hair, hair, glass, sign].map(material => new THREE.Mesh(new THREE.PlaneGeometry(), material));
  useDiffuseLighting(new THREE.Group().add(...shapes));
  const [first, second, bottle, lamp] = shapes.map(s => s.material);
  expect(first).toBeInstanceOf(THREE.MeshLambertMaterial);
  expect(first).toBe(second);
  expect(first?.name).toBe(hair.name);
  expect(first?.map).toBe(hair.map);
  expect(first?.alphaTest).toBe(hair.alphaTest);
  expect(bottle).toBe(glass);
  expect(lamp).toBe(sign);
});

test.each([1, 1.5, 2])("ambient occlusion matches the drawing buffer at pixel ratio %p", (ratio) => {
  const renderer = {
    getPixelRatio: () => ratio,
    getSize: (size: THREE.Vector2) => size.set(480, 280),
  } as THREE.WebGLRenderer;
  const resize = spyOn(GTAOPass.prototype, "setSize");
  try {
    const fx = postprocessing(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(resize).toHaveBeenLastCalledWith(480 * ratio, 280 * ratio);
    fx.setSize(360, 200);
    expect(resize).toHaveBeenLastCalledWith(360 * ratio, 200 * ratio);
  } finally {
    resize.mockRestore();
  }
});
