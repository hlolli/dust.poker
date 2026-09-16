import * as THREE from "three";

// The house band: a generated lounge loop, played from a point in the room through the
// camera's listener so it sits where the bar is, in VR too. Web Audio only, no samples.
// ponytail: four chords, a walking bass, brushed ride, comped electric piano and a
// vibraphone that wanders the chord tones. Fancier generative music can replace the
// `bar()` function without touching the plumbing.

const TEMPO = 92; // beats per minute
const BEAT = 60 / TEMPO;
const SWING = 0.62; // where the off-beat eighth falls, as a fraction of the beat
// ii V I vi in C, as MIDI note numbers: root, then the chord tones the piano and vibes use.
const CHORDS: { root: number; tones: number[] }[] = [
  { root: 38, tones: [62, 65, 69, 72] }, // Dm7
  { root: 43, tones: [65, 71, 74, 76] }, // G7 (with the 13th)
  { root: 36, tones: [64, 67, 71, 74] }, // Cmaj9
  { root: 45, tones: [64, 67, 72, 76] }, // Am7 (add 11)
];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export interface Lounge {
  /** Mutes or unmutes; the band keeps playing so it picks up mid-tune. */
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  stop(): void;
  /** Bars scheduled so far; a handle for checking it runs. */
  readonly bars: number;
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
  wet.gain.value = 0.25;
  const room = ctx.createGain();
  master.connect(dry);
  for (const seconds of [0.27, 0.41]) {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = seconds;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
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
  function tone(freq: number, t: number, dur: number, gain: number, type: OscillatorType, attack = 0.01, detune = 0) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(env);
    env.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
  function bass(midi: number, t: number, dur: number) {
    tone(hz(midi), t, dur, 0.22, "triangle", 0.02);
    tone(hz(midi), t, dur * 0.6, 0.06, "sine", 0.005); // the thump
  }
  function piano(tones: number[], t: number, dur: number, gain: number) {
    for (const m of tones) {
      tone(hz(m), t, dur, gain, "sine", 0.015, -4);
      tone(hz(m), t, dur * 0.8, gain * 0.5, "triangle", 0.015, 5);
    }
  }
  function vibes(midi: number, t: number, dur: number) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = hz(midi);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.16, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const trem = ctx.createGain(); // the motor: slow amplitude vibrato
    trem.gain.value = 1;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = ctx.createGain();
    depth.gain.value = 0.35;
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
  function ride(t: number, gain: number, dur = 0.12) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6000;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(hp);
    hp.connect(env);
    env.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // One bar of the tune, scheduled from time t0.
  let melody = 2; // index into the chord tones the vibes walk on
  let barCount = 0;
  function bar(t0: number, n: number) {
    const chord = CHORDS[n % CHORDS.length]!;
    const next = CHORDS[(n + 1) % CHORDS.length]!;
    // Walking bass: root, fifth, third, then a step toward the next root.
    const walk = [chord.root, chord.root + 7, chord.root + 4, next.root + (Math.random() < 0.5 ? -1 : 1)];
    walk.forEach((m, i) => bass(m, t0 + i * BEAT, BEAT * 0.95));
    // Ride: soft on the beat, lighter on the swung off-beat; brushes.
    for (let i = 0; i < 4; i++) {
      ride(t0 + i * BEAT, i % 2 === 1 ? 0.09 : 0.06);
      ride(t0 + (i + SWING) * BEAT, 0.035, 0.08);
    }
    // Piano comps on one and the and-of-two, sometimes on four.
    piano(chord.tones, t0, BEAT * 1.6, 0.05);
    piano(chord.tones, t0 + (1 + SWING) * BEAT, BEAT * 0.9, 0.035);
    if (Math.random() < 0.4) piano(chord.tones, t0 + 3 * BEAT, BEAT * 0.7, 0.03);
    // Vibes: one or two notes a bar, a step or a skip along the chord tones, an octave up.
    const notes = Math.random() < 0.6 ? 1 : 2;
    for (let i = 0; i < notes; i++) {
      melody = Math.max(0, Math.min(3, melody + [-1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 6)]!));
      const when = t0 + (i === 0 ? (Math.random() < 0.5 ? 0 : SWING) : 2 + SWING) * BEAT;
      vibes(chord.tones[melody]! + 12, when, BEAT * (notes === 1 ? 2.5 : 1.4));
    }
    barCount++;
  }

  // The scheduler: keep a bar and a half of music queued ahead of the audio clock.
  let nextBar = ctx.currentTime + 0.1;
  let n = 0;
  const timer = setInterval(() => {
    while (nextBar < ctx.currentTime + BEAT * 6) {
      bar(nextBar, n++);
      nextBar += BEAT * 4;
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
