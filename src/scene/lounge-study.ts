import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import backBarUrl from "../assets/lounge-study/backbar.glb";
import jacketUrl from "../assets/lounge-study/dealer-jacket.webp";
import jukeboxUrl from "../assets/lounge-study/jukebox.glb";
import cardBackUrl from "../assets/lounge-study/falcon-back.webp";
import buttonUrl from "../assets/lounge-study/falcon-button.glb";
import { BAR } from "./bar.ts";
import { printedCardMaterial } from "./cards.ts";

async function loadJukebox(loader: GLTFLoader) {
  const { scene: cabinet } = await loader.loadAsync(jukeboxUrl);
  cabinet.name = "Jazz jukebox";
  cabinet.position.set(BAR.x - 1.4, 0, BAR.z - BAR.length / 2 - 0.45);
  cabinet.lookAt(0, 0, 0);
  const front = cabinet.getObjectByName("Front");
  if (!(front instanceof THREE.Mesh) || !(front.material instanceof THREE.MeshStandardMaterial)) {
    throw new Error("The jukebox is missing its illuminated front");
  }
  const glass = front.material;
  return {
    cabinet,
    speaker: cabinet.localToWorld(new THREE.Vector3(0, 0.57, 0.2)),
    setMuted(muted: boolean) { glass.emissiveIntensity = muted ? 0 : 1.4; },
  };
}

async function optional<T>(name: string, request: Promise<T>): Promise<T | undefined> {
  try {
    return await request;
  } catch (error) {
    console.warn(`Could not load the Deco ${name}`, error);
  }
}

export async function loadLoungeStudy() {
  const loader = new GLTFLoader();
  const textures = new THREE.TextureLoader();
  const [model, jacket, jukebox, print, marker] = await Promise.all([
    optional("back bar", loader.loadAsync(backBarUrl)),
    optional("jacket", textures.loadAsync(jacketUrl)),
    optional("jukebox", loadJukebox(loader)),
    optional("card back", textures.loadAsync(cardBackUrl)),
    optional("dealer button", loader.loadAsync(buttonUrl)),
  ]);
  if (jacket) {
    jacket.flipY = false;
    jacket.colorSpace = THREE.SRGBColorSpace;
  }
  if (model) model.scene.name = "Deco back bar";
  if (marker) marker.scene.name = "Falcon dealer button";
  const cardBack = print && printedCardMaterial(print);
  return { backBar: model?.scene, jacket, jukebox, cardBack, dealerButton: marker?.scene };
}
