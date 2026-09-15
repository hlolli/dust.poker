import * as THREE from "three";
import marbleBlackColor from "../assets/textures/Marble006/Color.jpg";
import marbleBlackNormal from "../assets/textures/Marble006/NormalGL.jpg";
import marbleBlackRough from "../assets/textures/Marble006/Roughness.jpg";
import marbleWhiteColor from "../assets/textures/Marble012/Color.jpg";
import marbleWhiteNormal from "../assets/textures/Marble012/NormalGL.jpg";
import marbleWhiteRough from "../assets/textures/Marble012/Roughness.jpg";
import woodColor from "../assets/textures/Wood066/Color.jpg";
import woodNormal from "../assets/textures/Wood066/NormalGL.jpg";
import woodRough from "../assets/textures/Wood066/Roughness.jpg";
import fabricColor from "../assets/textures/Fabric030/Color.jpg";
import fabricNormal from "../assets/textures/Fabric030/NormalGL.jpg";
import fabricRough from "../assets/textures/Fabric030/Roughness.jpg";
import leatherColor from "../assets/textures/Leather011/Color.jpg";
import leatherNormal from "../assets/textures/Leather011/NormalGL.jpg";
import leatherRough from "../assets/textures/Leather011/Roughness.jpg";
import metalColor from "../assets/textures/Metal032/Color.jpg";
import metalNormal from "../assets/textures/Metal032/NormalGL.jpg";
import metalRough from "../assets/textures/Metal032/Roughness.jpg";
import plasterColor from "../assets/textures/Plaster001/Color.jpg";
import plasterNormal from "../assets/textures/Plaster001/NormalGL.jpg";
import plasterRough from "../assets/textures/Plaster001/Roughness.jpg";
import carpetColor from "../assets/textures/Carpet013/Color.jpg";
import carpetNormal from "../assets/textures/Carpet013/NormalGL.jpg";
import carpetRough from "../assets/textures/Carpet013/Roughness.jpg";

// CC0 PBR sets from ambientCG (see LICENSES.md). One material per surface kind, shared.

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();

function tex(url: string, repeat: number, srgb = false): THREE.Texture {
  const key = `${url}@${repeat}`;
  let t = cache.get(key);
  if (!t) {
    t = loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    cache.set(key, t);
  }
  return t;
}

type Set = { color: string; normal: string; rough: string };
function pbr(set: Set, repeat: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex(set.color, repeat, true),
    normalMap: tex(set.normal, repeat),
    roughnessMap: tex(set.rough, repeat),
    ...extra,
  });
}

const sets = {
  marbleBlack: { color: marbleBlackColor, normal: marbleBlackNormal, rough: marbleBlackRough },
  marbleWhite: { color: marbleWhiteColor, normal: marbleWhiteNormal, rough: marbleWhiteRough },
  wood: { color: woodColor, normal: woodNormal, rough: woodRough },
  fabric: { color: fabricColor, normal: fabricNormal, rough: fabricRough },
  leather: { color: leatherColor, normal: leatherNormal, rough: leatherRough },
  metal: { color: metalColor, normal: metalNormal, rough: metalRough },
  plaster: { color: plasterColor, normal: plasterNormal, rough: plasterRough },
  carpet: { color: carpetColor, normal: carpetNormal, rough: carpetRough },
};

/** Polished black marble: the hall floor. `repeat` is tiles across the surface. */
export const marbleBlack = (repeat = 6) => pbr(sets.marbleBlack, repeat, { color: 0x4a4a4a, roughness: 0.32 }); // polished, but the chandelier must not blow out on it
/** Veined white marble: columns and the sign panel. */
export const marbleWhite = (repeat = 1) => pbr(sets.marbleWhite, repeat, { roughness: 0.35 });
/** Dark polished wood: wainscot, table rail, bar. */
export const darkWood = (repeat = 2) => pbr(sets.wood, repeat, { color: 0x6b4a2b, roughness: 0.45 });
/** Velvet: the grey cloth set tinted. Deep green by default; burgundy for drapes. */
export const velvet = (color = 0x0f3d2e, repeat = 3) => pbr(sets.fabric, repeat, { color, roughness: 0.9 });
/** Red leather: chairs. */
export const leather = (repeat = 1) => pbr(sets.leather, repeat, { color: 0x8a1c1c, roughness: 0.55 });
/** Brass: the smooth metal set tinted gold, fully metallic. */
export const brass = (repeat = 1) => pbr(sets.metal, repeat, { color: 0xd4a34a, metalness: 1, roughness: 0.3 });
/** Chrome: the same metal untinted and polished; mirrors and 50s trim. */
export const chrome = (repeat = 1) => pbr(sets.metal, repeat, { color: 0xf0f0f0, metalness: 1, roughness: 0.06 });
/** Cream stone: the white marble set warmed, for Gaudi-style tree columns and vault ribs. */
export const stone = (repeat = 1) => pbr(sets.marbleWhite, repeat, { color: 0xe6dcc6, roughness: 0.6 });
/** Warm plaster: upper walls and vault. */
export const plaster = (repeat = 4) => pbr(sets.plaster, repeat, { color: 0xd8c9a8, roughness: 0.95 });
/** Red carpet under the table. */
export const carpet = (repeat = 3) => pbr(sets.carpet, repeat, { color: 0xb02a2a, roughness: 1 });
