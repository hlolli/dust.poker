import { expect, spyOn, test } from "bun:test";
import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { postprocessing } from "./fx.ts";

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
