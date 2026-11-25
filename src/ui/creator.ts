import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { type Avatar, loadAvatar, poseStanding } from "../scene/avatars.ts";
import { Life } from "../scene/life.ts";
import { applyLook, DEFAULT_LOOK, type Look, OUTFIT_COLOURS } from "../scene/look.ts";
import { MODELS } from "../scene/models.ts";
import { loungeRenderer, WEBGL_UNAVAILABLE } from "../scene/quality.ts";

/**
 * The character creator: a name, and a character turning slowly under a spotlight while the
 * player changes it: the build (one of the base characters), skin, outfit, height.
 * Styled in src/index.html (.creator). Resolves with the result, or null on "Never mind".
 */
export function showCreator(initial?: { name: string; look: Look }): Promise<{ name: string; look: Look } | null> {
  return new Promise((resolve) => {
    const look: Look = { ...DEFAULT_LOOK, ...initial?.look };
    const el = document.createElement("dialog");
    el.className = "creator";
    el.setAttribute("aria-labelledby", "creator-title");
    el.innerHTML = `
      <div class="stage"><canvas aria-hidden="true"></canvas><p class="preview-status" role="status"></p><button type="button" class="preview-motion"></button></div>
      <form class="controls">
        <h2 id="creator-title">${initial ? "Change your look" : "Who are you tonight?"}</h2>
        <label class="field"><span>Name on the plate</span><input name="name" maxlength="24" autocomplete="off" autofocus required value="${escape(initial?.name ?? "")}" placeholder="What the table calls you" /></label>
        <fieldset><legend>Build</legend><div class="tickets">${MODELS.map((m, i) => `<label class="ticket"><input type="radio" name="model" value="${i}" ${i === look.model ? "checked" : ""}/><span>${m.label}</span></label>`).join("")}</div></fieldset>
        <label class="field"><span>Skin tone</span><input type="range" name="skin" min="0" max="1" step="0.02" value="${look.skin}" /></label>
        <fieldset><legend>Outfit</legend><div class="swatches">${Object.entries(OUTFIT_COLOURS).map(([name, c]) => `<label class="swatch" title="${name}"><input type="radio" name="outfit" aria-label="${name}" value="${c}" ${c === look.outfit ? "checked" : ""}/><span style="background:${c}"></span></label>`).join("")}</div></fieldset>
        <label class="field"><span>Height</span><input type="range" name="height" min="0.92" max="1.08" step="0.01" value="${look.height}" /></label>
        <div class="row"><button type="submit" class="save">${initial ? "Keep this look" : "Take this name"}</button><button type="button" class="cancel">Never mind</button></div>
      </form>`;
    // The stage: a small renderer, the character standing under a warm key light, turning.
    const canvas = el.querySelector("canvas")!;
    const graphics = loungeRenderer(canvas, location.search, true);
    if (!graphics) {
      alert(WEBGL_UNAVAILABLE);
      resolve(null);
      return;
    }
    const { renderer, quality } = graphics;
    document.body.append(el);
    el.showModal();
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04, 0.1, 100, { size: quality.level === "low" ? 64 : 256 }).texture;
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
    let life: Life | null = null;
    let loading = 0;
    const previewStatus = el.querySelector<HTMLElement>(".preview-status")!;
    const setModel = async (model: number) => {
      const id = ++loading;
      previewStatus.textContent = "Loading character…";
      let a: Avatar;
      try {
        a = await loadAvatar(MODELS[model]?.url ?? MODELS[0]!.url);
      } catch {
        if (id === loading) previewStatus.textContent = "Character preview unavailable.";
        return;
      }
      if (id !== loading) return; // a later choice won
      if (avatar) scene.remove(avatar.root);
      avatar = a;
      a.root.rotation.y = 0; // toward the camera
      poseStanding(a);
      life = new Life(a, { seed: model, standing: true });
      applyLook(a, look);
      scene.add(a.root);
      previewStatus.textContent = "";
      requestFrame();
    };
    void setModel(look.model);
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const motion = el.querySelector<HTMLButtonElement>(".preview-motion")!;
    let animated = !reducedMotion.matches;
    let frame = 0;
    function requestFrame() {
      if (!frame) frame = requestAnimationFrame(draw);
    }
    const size = () => {
      const w = canvas.clientWidth || 320;
      const h = canvas.clientHeight || 480;
      const ratio = quality.pixelRatio(w, h, window.devicePixelRatio);
      if (canvas.width === Math.floor(w * ratio) && canvas.height === Math.floor(h * ratio) && camera.aspect === w / h) return;
      renderer.setDrawingBufferSize(w, h, ratio);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      requestFrame();
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(canvas);
    const resetTiming = () => quality.resetTiming();
    document.addEventListener("visibilitychange", resetTiming);
    function draw(now: number) {
      frame = 0;
      if (animated) {
        if (!document.hidden && quality.frame(now)) size();
        if (avatar) avatar.root.rotation.y = Math.sin(now / 4000) * 0.6;
        life?.apply(now, { focus: camera.position, others: [], deciding: false });
      }
      renderer.render(scene, camera);
      if (animated) {
        life?.restore();
        requestFrame();
      }
    }
    const setAnimation = (on: boolean) => {
      animated = on;
      motion.textContent = on ? "Pause preview" : "Play preview";
      quality.resetTiming();
      requestFrame();
    };
    const followPreference = () => setAnimation(!reducedMotion.matches);
    reducedMotion.addEventListener("change", followPreference);
    motion.onclick = () => setAnimation(!animated);
    followPreference();

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
      if (avatar && t.name !== "model") {
        applyLook(avatar, look);
        requestFrame();
      }
    };
    const close = (result: { name: string; look: Look } | null) => {
      loading++;
      cancelAnimationFrame(frame);
      observer.disconnect();
      reducedMotion.removeEventListener("change", followPreference);
      document.removeEventListener("visibilitychange", resetTiming);
      renderer.dispose();
      renderer.forceContextLoss();
      el.close();
      el.remove();
      resolve(result);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      close({ name: (form.elements.namedItem("name") as HTMLInputElement).value.trim().slice(0, 24) || "Player", look: { ...look } });
    };
    form.querySelector<HTMLButtonElement>(".cancel")!.onclick = () => close(null);
    el.oncancel = (event) => { event.preventDefault(); close(null); };
  });
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
