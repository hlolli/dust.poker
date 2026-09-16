import * as THREE from "three";

// The house band: generated lounge music, played from a point in the room through the
// camera's listener so it sits where the bar is, in VR too. Web Audio only, no samples.
//
// A day of sets on the UTC clock: each hour has its own key, tempo, tune and line-up, and
// the band plays by the wall clock, so two players in the room hear the same bar of the same
// set. Nights are ballads with the vibes; days swing harder; evenings run uptempo.

/** A chord as an offset from the key's root and a quality. */
type Chord = { root: number; q: "maj" | "min" | "dom" | "half" };
const TONES: Record<Chord["q"], number[]> = {
  maj: [0, 4, 7, 11, 14], // maj9
  min: [0, 3, 7, 10, 14], // m9
  dom: [0, 4, 7, 10, 21], // 7 with the 13th
  half: [0, 3, 6, 10, 13], // m7b5
};
// Tunes as bar-by-bar chords in a key. Each set plays one as its A section and another as
// its B section, AABA, thirty-two bars a chorus.
const TUNES: Chord[][] = [
  [{ root: 2, q: "min" }, { root: 7, q: "dom" }, { root: 0, q: "maj" }, { root: 9, q: "min" }], // ii V I vi
  [{ root: 0, q: "maj" }, { root: 9, q: "min" }, { root: 2, q: "min" }, { root: 7, q: "dom" }], // I vi ii V
  [{ root: 0, q: "dom" }, { root: 0, q: "dom" }, { root: 0, q: "dom" }, { root: 0, q: "dom" }, { root: 5, q: "dom" }, { root: 5, q: "dom" }, { root: 0, q: "dom" }, { root: 0, q: "dom" }, { root: 7, q: "dom" }, { root: 5, q: "dom" }, { root: 0, q: "dom" }, { root: 7, q: "dom" }], // twelve bars
  [{ root: 0, q: "min" }, { root: 8, q: "maj" }, { root: 2, q: "half" }, { root: 7, q: "dom" }], // i bVI ii V, the minor tune
  [{ root: 0, q: "maj" }, { root: 5, q: "maj" }, { root: 4, q: "min" }, { root: 9, q: "min" }, { root: 2, q: "min" }, { root: 7, q: "dom" }, { root: 0, q: "maj" }, { root: 7, q: "dom" }], // the bossa
  [{ root: 4, q: "min" }, { root: 9, q: "dom" }, { root: 2, q: "min" }, { root: 7, q: "dom" }, { root: 0, q: "maj" }, { root: 0, q: "maj" }, { root: 2, q: "min" }, { root: 7, q: "dom" }], // iii VI ii V
];

export type Set = {
  hour: number;
  key: number; // semitones above C
  tempo: number;
  swing: number;
  a: Chord[];
  b: Chord[];
  /** Who is on the stand. */
  ride: boolean;
  piano: boolean;
  vibes: boolean;
  /** How often the vibes and the piano speak, 0..1. */
  busy: number;
};

/** The set for a UTC hour. Keys go round the cycle of fifths; the mood follows the clock. */
export function setFor(hour: number): Set {
  const h = ((hour % 24) + 24) % 24;
  const night = h < 6;
  const morning = h >= 6 && h < 12;
  const evening = h >= 18;
  return {
    hour: h,
    key: (h * 7) % 12,
    tempo: night ? 64 + h * 2 : morning ? 84 + (h - 6) * 2 : evening ? 104 + (h - 18) * 4 : 92 + (h - 12) * 2,
    swing: night ? 0.58 : evening ? 0.66 : 0.62,
    a: TUNES[[0, 1, 3, 4, 5, 2][h % 6]!]!,
    b: TUNES[[5, 3, 0, 1, 2, 4][Math.floor(h / 4) % 6]!]!,
    ride: !night || h >= 4,
    piano: !(night && h % 2 === 1),
    vibes: !(evening && h % 3 === 2),
    busy: night ? 0.35 : evening ? 0.8 : 0.55,
  };
}

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

  /** Bar `n` of a set's chorus: AABA over the set's two tunes. */
  function chordAt(set: Set, n: number): { chord: Chord; next: Chord } {
    const section = (i: number) => {
      const s = Math.floor(i / 8) % 4;
      const tune = s === 2 ? set.b : set.a;
      return tune[i % tune.length]!;
    };
    return { chord: section(n), next: section(n + 1) };
  }

  // One bar of the set, scheduled from time t0.
  let melody = 2; // index into the chord tones the vibes walk on
  let barCount = 0;
  function bar(set: Set, t0: number, n: number) {
    const beat = 60 / set.tempo;
    const { chord, next } = chordAt(set, n);
    const root = 36 + set.key + chord.root;
    const tones = TONES[chord.q].map((i) => 60 + set.key + chord.root + i);
    // Walking bass: root, fifth, third, then a step toward the next root.
    const nextRoot = 36 + set.key + next.root;
    const third = chord.q === "maj" || chord.q === "dom" ? 4 : 3;
    const walk = [root, root + 7, root + third, nextRoot + (Math.random() < 0.5 ? -1 : 1)];
    walk.forEach((m, i) => bass(m, t0 + i * beat, beat * 0.95));
    // Ride: soft on the beat, lighter on the swung off-beat; brushes.
    if (set.ride) {
      for (let i = 0; i < 4; i++) {
        ride(t0 + i * beat, i % 2 === 1 ? 0.09 : 0.06);
        ride(t0 + (i + set.swing) * beat, 0.035, 0.08);
      }
    }
    // Piano comps on one and the and-of-two, sometimes on four.
    if (set.piano) {
      piano(tones.slice(0, 4), t0, beat * 1.6, 0.05);
      if (Math.random() < set.busy + 0.2) piano(tones.slice(0, 4), t0 + (1 + set.swing) * beat, beat * 0.9, 0.035);
      if (Math.random() < set.busy * 0.6) piano(tones.slice(1, 5), t0 + 3 * beat, beat * 0.7, 0.03);
    }
    // Vibes: one or two notes a bar, a step or a skip along the chord tones, an octave up.
    if (set.vibes) {
      const notes = Math.random() < set.busy ? 2 : 1;
      for (let i = 0; i < notes; i++) {
        melody = Math.max(0, Math.min(4, melody + [-1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 6)]!));
        const when = t0 + (i === 0 ? (Math.random() < 0.5 ? 0 : set.swing) : 2 + set.swing) * beat;
        vibes(tones[melody]! + 12, when, beat * (notes === 1 ? 2.5 : 1.4));
      }
    }
    barCount++;
  }

  // The scheduler: the band plays by the UTC clock. The set is the hour's; the bar is where
  // the hour's bars have got to; the next bar starts on the wall-clock boundary.
  const wallOffset = Date.now() / 1000 - ctx.currentTime; // wall seconds = audio seconds + this
  const hourOf = (wall: number) => Math.floor(wall / 3600) % 24; // UTC hours sit on the epoch's hour marks
  const intoHour = (wall: number) => wall % 3600;
  const barLength = (set: Set) => (60 / set.tempo) * 4;
  let current = setFor(hourOf(wallOffset + ctx.currentTime));
  let next: number | null = null; // wall time of the next bar to schedule
  const timer = setInterval(() => {
    for (;;) {
      const now = wallOffset + ctx.currentTime;
      if (next === null) next = now - (intoHour(now) % barLength(setFor(hourOf(now)))) + barLength(setFor(hourOf(now))); // the bar boundary ahead
      if (next - wallOffset > ctx.currentTime + 2.5) break;
      const set = setFor(hourOf(next));
      if (set.hour !== current.hour) current = set;
      bar(set, next - wallOffset, Math.round(intoHour(next) / barLength(set)));
      next += barLength(set);
      if (hourOf(next) !== set.hour) next -= intoHour(next); // the new hour's set starts on the hour
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
