/** A chord as an offset from the key's root and a quality. */
type Chord = { root: number; q: "maj" | "min" | "dom" | "half" };
const TONES: Record<Chord["q"], number[]> = {
  maj: [0, 4, 7, 11, 14], // maj9
  min: [0, 3, 7, 10, 14], // m9
  dom: [0, 4, 7, 10, 21], // 7 with the 13th
  half: [0, 3, 6, 10, 13], // m7b5
};
// Eight-bar A and B sections loop the shorter changes. A blues set plays all twelve bars.
const TUNES = {
  twoFive: [{ root: 2, q: "min" }, { root: 7, q: "dom" }, { root: 0, q: "maj" }, { root: 9, q: "min" }], // ii V I vi
  turnaround: [{ root: 0, q: "maj" }, { root: 9, q: "min" }, { root: 2, q: "min" }, { root: 7, q: "dom" }], // I vi ii V
  blues: [{ root: 0, q: "dom" }, { root: 0, q: "dom" }, { root: 0, q: "dom" }, { root: 0, q: "dom" }, { root: 5, q: "dom" }, { root: 5, q: "dom" }, { root: 0, q: "dom" }, { root: 0, q: "dom" }, { root: 7, q: "dom" }, { root: 5, q: "dom" }, { root: 0, q: "dom" }, { root: 7, q: "dom" }], // twelve bars
  minor: [{ root: 0, q: "min" }, { root: 8, q: "maj" }, { root: 2, q: "half" }, { root: 7, q: "dom" }], // i bVI ii V, the minor tune
  bossa: [{ root: 0, q: "maj" }, { root: 5, q: "maj" }, { root: 4, q: "min" }, { root: 9, q: "min" }, { root: 2, q: "min" }, { root: 7, q: "dom" }, { root: 0, q: "maj" }, { root: 7, q: "dom" }], // the bossa
  bridge: [{ root: 4, q: "min" }, { root: 9, q: "dom" }, { root: 2, q: "min" }, { root: 7, q: "dom" }, { root: 0, q: "maj" }, { root: 0, q: "maj" }, { root: 2, q: "min" }, { root: 7, q: "dom" }], // iii VI ii V
} satisfies Record<string, Chord[]>;

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
  busy: number; // how readily the soloist ornaments a held note
  feel: "ballad" | "swing" | "bossa" | "blues";
};

/** The set for a UTC hour. Keys go round the cycle of fifths; the mood follows the clock. */
export function setFor(hour: number): Set {
  const h = ((hour % 24) + 24) % 24;
  const night = h < 6;
  const morning = h >= 6 && h < 12;
  const evening = h >= 18;
  const a = [TUNES.twoFive, TUNES.turnaround, TUNES.minor, TUNES.bossa, TUNES.bridge, TUNES.blues][h % 6]!;
  const feel = a === TUNES.blues ? "blues" : night ? "ballad" : a === TUNES.bossa ? "bossa" : "swing";
  return {
    hour: h,
    key: (h * 7) % 12,
    tempo: night ? 64 + h * 2 : morning ? 84 + (h - 6) * 2 : evening ? 104 + (h - 18) * 4 : 92 + (h - 12) * 2,
    swing: feel === "bossa" ? 0.5 : night ? 0.58 : evening ? 0.66 : 0.62,
    a,
    b: [TUNES.bridge, TUNES.minor, TUNES.twoFive, TUNES.turnaround, TUNES.bridge, TUNES.bossa][Math.floor(h / 4)]!,
    ride: !night || h >= 4,
    piano: !(night && h % 2 === 1),
    vibes: !(evening && h % 3 === 2),
    busy: night ? 0.35 : evening ? 0.8 : 0.55,
    feel,
  };
}

type Instrument = "bass" | "piano" | "vibes";
type Hit = { beat: number; length: number; gain: number } & (
  | { voice: Instrument; midi: number }
  | { voice: "ride" | "brush" }
);

// One four-bar question and answer, and a second one for the bridge. A note gives its
// eighth-note slot, chord-tone index, register in MIDI, and length in beats. The register
// keeps the shape of the line when the same phrase comes around over different changes.
type Phrase = readonly (readonly [slot: number, tone: number, register: number, length: number, alteration?: number])[];
const HEAD: readonly Phrase[] = [
  [[1, 1, 67, 0.32], [2, 2, 70, 1.1], [5, 4, 74, 0.30], [6, 3, 71, 0.85]],
  [[0, 1, 69, 1.7], [5, 2, 66, 0.38]],
  [[1, 3, 71, 0.32], [2, 2, 69, 0.85], [4, 1, 66, 0.65], [6, 4, 65, 0.8]],
  [[0, 1, 65, 2.4]],
];
const BRIDGE: readonly Phrase[] = [
  [[0, 2, 70, 0.8], [3, 3, 73, 0.35], [4, 4, 76, 1.6]],
  [[1, 3, 74, 0.45], [3, 1, 71, 0.45], [5, 2, 69, 0.9]],
  [[0, 4, 74, 1.2], [4, 3, 72, 0.8], [7, 1, 69, 0.3]],
  [[0, 2, 69, 1.6], [4, 1, 67, 0.8]],
];
// The flattened third rubs against the dominant chord, then resolves up to its major third.
const BLUES_RIFF: readonly Phrase[] = [
  [[0, 0, 65, 0.75], [3, 1, 68, 0.3, -1], [4, 1, 68, 0.7], [6, 2, 71, 0.8]],
  [[0, 3, 73, 1.2], [4, 2, 71, 0.6], [6, 1, 68, 0.75]],
  [[1, 0, 65, 0.3], [2, 1, 68, 0.65, -1], [4, 1, 68, 0.5], [6, 2, 71, 0.8]],
  [[0, 1, 68, 1.25, -1], [4, 0, 65, 1.25]],
];
const SWING_COMP = [[0, 3], [2, 5], [1, 4], [3, 6]] as const;

function chordAt(set: Set, bar: number): Chord {
  if (set.feel === "blues") return set.a[bar % 12]!;
  const tune = Math.floor(bar / 8) % 4 === 2 ? set.b : set.a;
  return tune[(bar % 8) % tune.length]!;
}

// Place a pitch class in the octave nearest the instrument's intended register.
const near = (pitch: number, register: number) => pitch + 12 * Math.round((register - pitch) / 12);

/** The whole band for one bar. Joining mid-phrase produces the same part as playing from bar zero. */
export function arrangeBar(set: Set, n: number): Hit[] {
  const blues = set.feel === "blues";
  const bossa = set.feel === "bossa";
  const ballad = set.feel === "ballad";
  const form = blues ? 12 : 32;
  const chorus = Math.floor(n / form);
  const bar = n % form;
  const bridge = blues ? bar >= 8 : bar >= 16 && bar < 24;
  const solo = chorus % 3 === 1;
  const line = bar % 4;
  const chord = chordAt(set, n);
  const root = set.key + chord.root;
  const tones = TONES[chord.q];
  const hits: Hit[] = [];
  const beatAt = (slot: number) => Math.floor(slot / 2) + (slot % 2) * set.swing;
  function note(voice: Instrument, slot: number, midi: number, length: number, gain: number) {
    hits.push({ voice, beat: beatAt(slot), midi, length, gain });
  }
  function drum(voice: "ride" | "brush", slot: number, length: number, gain: number) {
    hits.push({ voice, beat: beatAt(slot), length, gain });
  }

  // Let the bass establish two beats to the bar on a ballad. In a walking chorus its
  // last note leads by a semitone into the actual downbeat of the following bar.
  const low = near(root, 39);
  const fifth = near(root + tones[2]!, low + 4);
  const next = near(set.key + chordAt(set, n + 1).root, 39);
  const approach = next + (fifth > next ? 1 : -1);
  note("bass", 0, low, ballad ? 1.6 : 0.87, 0.23);
  if (bossa) {
    note("bass", 3, low, 0.4, 0.12);
    note("bass", 4, fifth, 1.15, 0.19);
    if (line % 2 === 1) note("bass", 7, approach, 0.43, 0.14);
  } else if (ballad && !solo) {
    note("bass", 4, fifth, 1.35, 0.18);
    if (line === 3) note("bass", 7, approach, 0.32, 0.12);
  } else {
    const third = near(root + tones[1]!, low + 3);
    note("bass", 2, line % 2 ? fifth : third, 0.87, 0.18);
    note("bass", 4, line % 2 ? third : fifth, 0.90, 0.20);
    note("bass", 6, approach, 0.84, 0.17);
  }

  // The bass already has the root. The piano keeps the third, seventh and colour
  // note close to middle C, leaving the lead room above the accompaniment.
  if (set.piano) {
    const voicing = [tones[1]!, tones[3]!, tones[4]!].map((i) => near(root + i, 59));
    const slots = ballad ? (line % 2 ? [3] : [0, 5]) : bossa ? (line % 2 ? [1, 4, 7] : [0, 3, 6])
      : SWING_COMP[(line + Math.floor(bar / 8) + chorus) % 4]!;
    for (const slot of slots) {
      for (const pitch of voicing) note("piano", slot, pitch, ballad ? 1.8 : slot % 2 ? 0.58 : 0.92, slot % 2 ? 0.034 : 0.042);
    }
  }

  // Vibes call, piano answers. On the solo chorus they trade four bars at a time
  // and pick up long notes from a semitone below. The last chorus brings the head back.
  const pianoTurn = solo ? Math.floor(bar / 4) % 2 === 0 : line >= 2;
  const lead = set.piano && (!set.vibes || pianoTurn) ? "piano" : "vibes";
  const theme = blues ? BLUES_RIFF : HEAD;
  const phrase = (bridge !== solo ? BRIDGE : theme)[line]!;
  for (const [slot, degree, register, length, alteration = 0] of phrase) {
    const pitch = near(root + tones[degree]! + alteration, register + (bridge ? 2 : 0));
    const gain = (slot % 2 ? 0.112 : 0.14) * (ballad ? 0.86 : 1);
    if (solo && slot % 2 === 0 && length > 2 - set.busy) {
      note(lead, slot, pitch - 1, set.swing * 0.8, gain * 0.65);
      note(lead, slot + 1, pitch, length - set.swing, gain);
    } else {
      note(lead, slot, pitch, length, gain);
    }
  }

  if (set.ride) {
    if (bossa) {
      for (const slot of [0, 2, 4, 6]) drum("ride", slot, 0.23, 0.046);
      for (const slot of line % 2 ? [2, 5] : [0, 3, 6]) drum("brush", slot, 0.18, 0.085);
    } else {
      for (const slot of [0, 2, 4, 6]) drum("ride", slot, 0.38, slot % 4 ? 0.073 : 0.050);
      drum("ride", 3, 0.18, 0.037);
      if (!ballad) drum("ride", 7, 0.18, 0.037);
      drum("brush", 2, 0.42, 0.09);
      drum("brush", 6, 0.48, 0.11);
      if (bar % 8 === 7 || bar === form - 1) drum("brush", 7, 0.24, 0.07);
    }
  }
  return hits;
}
