import * as THREE from "three";
import { arrangeBar, setFor, type Set } from "./lounge-score.ts";

export { setFor, type Set } from "./lounge-score.ts";

// The house band: generated lounge music, played from a point in the room through the
// camera's listener so it sits where the bar is, in VR too. Web Audio only, no samples.
//
// A day of sets on the UTC clock: each hour has its own key, tempo, tune and line-up, and
// the band plays by the wall clock, so two players in the room hear the same bar of the same
// set. Nights are ballads with the vibes; days swing harder; evenings run uptempo.

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export interface Lounge {
  /** Mutes or unmutes; the band keeps playing so it picks up mid-tune. */
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  stop(): void;
  /** Bars scheduled so far; a handle for checking it runs. */
  readonly bars: number;
  /** The set on the stand now. */
  readonly set: Set;
}

/** Starts the band at `at` (world position). Call from a user gesture: browsers require one. */
export function startLounge(camera: THREE.Camera, scene: THREE.Scene, at: THREE.Vector3): Lounge {
  const listener = new THREE.AudioListener();
  camera.add(listener);
  const ctx = listener.context;
  if (ctx.state === "suspended") void ctx.resume();

  // Master -> a little room (two feedback delays) -> positional output.
  const master = ctx.createGain();
  master.gain.value = 0.5;
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  wet.gain.value = 0.18;
  const room = ctx.createGain();
  master.connect(dry);
  for (const seconds of [0.083, 0.139]) {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = seconds;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.28;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 2200;
    master.connect(delay);
    delay.connect(damp);
    damp.connect(feedback);
    feedback.connect(delay);
    damp.connect(room);
  }
  room.connect(wet);
  const out = ctx.createGain();
  dry.connect(out);
  wet.connect(out);

  const speaker = new THREE.PositionalAudio(listener);
  speaker.setNodeSource(out as unknown as AudioBufferSourceNode);
  speaker.setRefDistance(2.5);
  speaker.setRolloffFactor(1.1);
  speaker.setMaxDistance(30);
  const stage = new THREE.Object3D();
  stage.position.copy(at);
  stage.add(speaker);
  scene.add(stage);

  // Voices.
  const pianoString = ctx.createPeriodicWave(new Float32Array(7), new Float32Array([0, 1, 0.32, 0.17, 0.07, 0.045, 0.02]));
  function tone(freq: number, t: number, dur: number, gain: number, type: OscillatorType, attack = 0.01) {
    const osc = ctx.createOscillator();
    if (type === "custom") osc.setPeriodicWave(pianoString);
    else osc.type = type;
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(env);
    env.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
  function bass(midi: number, t: number, dur: number, gain: number) {
    tone(hz(midi), t, dur, gain, "triangle", 0.012);
    tone(2 * hz(midi), t, Math.min(0.12, dur), gain * 0.38, "sine", 0.004); // the pluck
  }
  function piano(midi: number, t: number, dur: number, gain: number) {
    tone(hz(midi), t, dur, gain, "custom", 0.007);
    tone(hz(midi) * 2.004, t, Math.min(0.21, dur), gain * 0.28, "sine", 0.003);
  }
  function vibes(midi: number, t: number, dur: number, gain: number) {
    tone(4 * hz(midi), t, Math.min(0.11, dur), gain * 0.24, "sine", 0.003); // mallet against the bar
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = hz(midi);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const trem = ctx.createGain(); // the motor: slow amplitude vibrato
    trem.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = ctx.createGain();
    depth.gain.value = 0.22;
    lfo.connect(depth);
    depth.connect(trem.gain);
    osc.connect(env);
    env.connect(trem);
    trem.connect(master);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }
  const noise = (() => {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  })();
  function percussion(voice: "ride" | "brush", t: number, gain: number, dur: number) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    const brush = voice === "brush";
    filter.type = brush ? "bandpass" : "highpass";
    filter.frequency.value = brush ? 1900 : 6200;
    filter.Q.value = 0.7;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + Math.min(dur / 3, brush ? 0.038 : 0.003));
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(env);
    env.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  let barCount = 0;
  function bar(set: Set, t0: number, n: number, secondsLeftInSet: number) {
    const beat = 60 / set.tempo;
    for (const hit of arrangeBar(set, n)) {
      const offset = hit.beat * beat;
      const dur = Math.min(hit.length * beat, secondsLeftInSet - offset);
      if (dur < 0.025) continue; // the hour can change partway through the last bar
      const t = t0 + offset;
      switch (hit.voice) {
        case "bass": bass(hit.midi, t, dur, hit.gain); break;
        case "piano": piano(hit.midi, t, dur, hit.gain); break;
        case "vibes": vibes(hit.midi, t, dur, hit.gain); break;
        case "ride":
        case "brush": percussion(hit.voice, t, hit.gain, dur); break;
      }
    }
    barCount++;
  }

  // The scheduler: the band plays by the UTC clock. The set is the hour's; the bar is where
  // the hour's bars have got to; the next bar starts on the wall-clock boundary.
  const hourOf = (wall: number) => Math.floor(wall / 3600) % 24; // UTC hours sit on the epoch's hour marks
  const intoHour = (wall: number) => wall % 3600;
  const barLength = (set: Set) => (60 / set.tempo) * 4;
  let current = setFor(hourOf(Date.now() / 1000));
  let next: number | null = null; // wall time of the next bar to schedule
  const timer = setInterval(() => {
    if (ctx.state !== "running") return;
    const now = Date.now() / 1000;
    const audioNow = ctx.currentTime;
    if (next === null || next < now - 0.05) {
      // On entry or after a backgrounded tab wakes, join at the next downbeat.
      const elapsed = intoHour(now);
      const length = barLength(setFor(hourOf(now)));
      next = now - elapsed + Math.min(3600, (Math.floor(elapsed / length) + 1) * length);
    }
    while (next <= now + 2.5) {
      const set = setFor(hourOf(next));
      if (set.hour !== current.hour) current = set;
      const elapsed = intoHour(next);
      const length = barLength(set);
      const n = Math.round(elapsed / length);
      bar(set, audioNow + Math.max(0, next - now), n, 3600 - elapsed);
      next = next - elapsed + Math.min(3600, (n + 1) * length);
    }
  }, 200);

  let muted = false;
  return {
    get muted() {
      return muted;
    },
    get bars() {
      return barCount;
    },
    get set() {
      return current;
    },
    setMuted(m) {
      muted = m;
      out.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05);
    },
    stop() {
      clearInterval(timer);
      out.disconnect();
      scene.remove(stage);
    },
  };
}
