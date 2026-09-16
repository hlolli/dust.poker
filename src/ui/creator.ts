import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { type Avatar, idleFace, loadAvatar, poseStanding } from "../scene/avatars.ts";
import { applyLook, DEFAULT_LOOK, type Look, OUTFIT_COLOURS } from "../scene/look.ts";
import { MODELS } from "../scene/models.ts";

/**
 * The character creator: a name, and a character turning slowly under a spotlight while the
 * player changes it: the build (one of the base characters), skin, outfit, height.
 * Styled in src/index.html (.creator). Resolves with the result, or null on "Never mind".
 */
export function showCreator(initial?: { name: string; look: Look }): Promise<{ name: string; look: Look } | null> {
  return new Promise((resolve) => {
    const look: Look = { ...DEFAULT_LOOK, ...initial?.look };
    const el = document.createElement("section");
    el.className = "creator";
    el.innerHTML = `
      <div class="stage"><canvas></canvas></div>
      <form class="controls">
        <h2>${initial ? "Change your look" : "Who are you tonight?"}</h2>
        <label class="field"><span>Name on the plate</span><input name="name" maxlength="24" autocomplete="off" required value="${escape(initial?.name ?? "")}" placeholder="What the table calls you" /></label>
        <fieldset><legend>Build</legend><div class="tickets">${MODELS.map((m, i) => `<label class="ticket"><input type="radio" name="model" value="${i}" ${i === look.model ? "checked" : ""}/><span>${m.label}</span></label>`).join("")}</div></fieldset>
        <fieldset><legend>Skin</legend><input type="range" name="skin" min="0" max="1" step="0.02" value="${look.skin}" /></fieldset>
        <fieldset><legend>Outfit</legend><div class="swatches">${OUTFIT_COLOURS.map((c) => `<label class="swatch"><input type="radio" name="outfit" value="${c}" ${c === look.outfit ? "checked" : ""}/><span style="background:${c}"></span></label>`).join("")}</div></fieldset>
        <fieldset><legend>Height</legend><input type="range" name="height" min="0.92" max="1.08" step="0.01" value="${look.height}" /></fieldset>
        <div class="row"><button type="submit" class="save">${initial ? "Keep this look" : "Take this name"}</button><button type="button" class="cancel">Never mind</button></div>
      </form>`;
    document.body.append(el);

    // The stage: a small renderer, the character standing under a warm key light, turning.
    const canvas = el.querySelector("canvas")!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5;
    pmrem.dispose();
    const key = new THREE.SpotLight(0xffe0b0, 40, 12, 0.5, 0.6, 1.5);
    key.position.set(1.5, 3.2, 2.5);
    scene.add(key, new THREE.AmbientLight(0x40202a, 1.5));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.6, 48), new THREE.MeshStandardMaterial({ color: 0x3b0c18, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    camera.position.set(0, 1.05, 3.6);
    camera.lookAt(0, 0.95, 0);
    let avatar: Avatar | null = null;
    let loading = 0;
    const setModel = async (model: number) => {
      const id = ++loading;
      const a = await loadAvatar(MODELS[model]?.url ?? MODELS[0]!.url);
      if (id !== loading) return; // a later choice won
      if (avatar) scene.remove(avatar.root);
      avatar = a;
      a.root.rotation.y = 0; // toward the camera
      poseStanding(a);
      applyLook(a, look);
      scene.add(a.root);
    };
    void setModel(look.model);
    let frame = 0;
    const size = () => {
      const w = canvas.clientWidth || 320;
      const h = canvas.clientHeight || 480;
      if (canvas.width !== w * renderer.getPixelRatio() || canvas.height !== h * renderer.getPixelRatio()) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
    };
    const loop = (now: number) => {
      size();
      if (avatar) {
        avatar.root.rotation.y = Math.sin(now / 4000) * 0.6;
        idleFace(avatar, now);
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    // The controls change the look as they move.
    const form = el.querySelector<HTMLFormElement>("form")!;
    form.oninput = (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name === "model") void setModel((look.model = Number(t.value)));
      else if (t.name === "skin") look.skin = Number(t.value);
      else if (t.name === "height") look.height = Number(t.value);
      else if (t.name === "hair") look.hair = t.value;
      else if (t.name === "outfit") look.outfit = t.value;
      else return;
      if (avatar && t.name !== "model") applyLook(avatar, look);
    };
    const close = (result: { name: string; look: Look } | null) => {
      cancelAnimationFrame(frame);
      renderer.dispose();
      el.remove();
      resolve(result);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      close({ name: (form.elements.namedItem("name") as HTMLInputElement).value.trim().slice(0, 24) || "Player", look: { ...look } });
    };
    form.querySelector<HTMLButtonElement>(".cancel")!.onclick = () => close(null);
    (form.elements.namedItem("name") as HTMLInputElement).focus();
  });
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
