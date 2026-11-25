// What makes the room read as a room: shadows from one lamp over the table, and ambient
// occlusion (GTAO) as a post-processing pass, so chips sit on the felt and chairs meet the
// floor. WebGL2, three's own passes. Off with ?fx=off, which a slow phone may want; the
// post-processing runs only outside XR, where three renders each eye itself.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";

export const fxOn = () => new URLSearchParams(location.search).get("fx") !== "off";

/**
 * The room's own reflections: a cube map of the hall taken once from above the table, once its
 * textures have loaded, as the scene's environment. Marble, brass, chrome and the rail then
 * reflect the hall, and every surface gets its soft bounce light from the hall's own colours;
 * the stock studio environment it replaces put white boxes in the floor and the mirrors.
 * Only the `keep` groups are in the picture: people and cards move, and a reflection taken
 * from one point cannot follow them.
 */
export async function reflectRoom(renderer: THREE.WebGLRenderer, scene: THREE.Scene, keep: THREE.Object3D[], ready: Promise<void>, size = 256): Promise<void> {
  await ready;
  const hidden = scene.children.filter((o) => o.visible && !keep.includes(o) && !(o as THREE.Light).isLight);
  for (const o of hidden) o.visible = false;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0, 0.1, 40, { size, position: new THREE.Vector3(0, 1.8, 0) });
  pmrem.dispose();
  for (const o of hidden) o.visible = true;
  const before = scene.environment;
  scene.environment = target.texture;
  scene.environmentIntensity = 1;
  before?.dispose();
}

/** Marks every mesh under `o` as casting and receiving shadows; returns `o`. */
export function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((m) => {
    if ((m as THREE.Mesh).isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return o;
}

/** Shadows on: the renderer's map, a lamp over the table that casts them, and the objects that take part. */
export function lightTable(renderer: THREE.WebGLRenderer, scene: THREE.Scene, casters: THREE.Object3D[]): THREE.SpotLight {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // three 0.186 dropped the soft variant; the radius below blurs instead
  // The card-room lamp: a warm spot from above the table, tight enough for a crisp map.
  const lamp = new THREE.SpotLight(0xffe7c6, 100, 9, 0.62, 0.65, 2);
  lamp.position.set(0, 4.2, 0);
  lamp.target.position.set(0, 0.75, 0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.camera.near = 1.5;
  lamp.shadow.camera.far = 6;
  lamp.shadow.bias = -0.0004;
  lamp.shadow.normalBias = 0.02;
  lamp.shadow.radius = 3;
  scene.add(lamp, lamp.target);
  for (const c of casters) shadowed(c);
  return lamp;
}

export type Fx = { render(): void; setSize(width: number, height: number): void; dispose(): void };

/** The post-processing chain: the scene, ambient occlusion, then tone mapping and colour space. */
export function postprocessing(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): Fx {
  const size = renderer.getSize(new THREE.Vector2()).multiplyScalar(renderer.getPixelRatio()).floor();
  // Multisampled target: the composer would otherwise lose the canvas's antialiasing.
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  // All targets use drawing-buffer pixels, including after moving to another display.
  composer.setPixelRatio(1);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = 0.85;
  // Radius in metres: contact shadows of chips and cards, not room-wide darkening.
  gtao.updateGtaoMaterial({ radius: 0.2, distanceExponent: 1, thickness: 1, distanceFallOff: 1, scale: 1, samples: 12, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 12 });
  // The pass draws the scene's depth and normals to find what occludes what, hiding only points
  // and lines. See-through meshes, the table's labels above all, went in as solid panes and
  // darkened the felt around nothing: a shadow floating over the table. They stay out too.
  const pass = gtao as unknown as { _overrideVisibility(): void; _visibilityCache: THREE.Object3D[] };
  const hideLines = pass._overrideVisibility.bind(gtao);
  pass._overrideVisibility = () => {
    hideLines();
    scene.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material) && (m.material as THREE.Material).transparent) pass._visibilityCache.push(m);
    });
    for (const o of pass._visibilityCache) o.visible = false;
  };
  composer.addPass(gtao);
  composer.addPass(new OutputPass());
  return {
    render() {
      // The colour and normals passes see the same lamp and casters. Refresh its
      // shadow map on the first render only, then hand control back for XR frames.
      const shadow = renderer.shadowMap;
      const autoUpdate = shadow.autoUpdate;
      shadow.needsUpdate ||= autoUpdate;
      shadow.autoUpdate = false;
      try {
        composer.render();
      } finally {
        shadow.autoUpdate = autoUpdate;
      }
    },
    setSize: (w, h) => composer.setSize(Math.floor(w * renderer.getPixelRatio()), Math.floor(h * renderer.getPixelRatio())),
    dispose() {
      for (const pass of composer.passes) pass.dispose();
      // GTAOPass.dispose in Three r186 omits these two shader materials.
      gtao.gtaoMaterial.dispose();
      gtao.blendMaterial.dispose();
      composer.dispose();
    },
  };
}
