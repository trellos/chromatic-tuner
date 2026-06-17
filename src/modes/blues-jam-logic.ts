// Pure music-theory helpers for Blues Jam mode.
// Keep this module UI-independent: progression shapes, chord/bass voicings, and
// grid layout derive entirely from the selected key, progression, and bass style.

export type BluesProgressionId =
  | "twelve-bar"
  | "twelve-bar-quick-change"
  | "sixteen-bar"
  | "eight-bar"
  | "minor-blues";

// A chord quality determines the comping voicing, the chord tones the bass
// styles draw from, and the label suffix shown in the grid. Intervals are
// semitone offsets from the chord root.
export type ChordQuality = "dom7" | "min7" | "maj";

type QualitySpec = {
  suffix: string;
  // chordIntervals[0..] = root, third, fifth, (seventh). The third/fifth also
  // seed the walking bass line.
  chordIntervals: number[];
};

const QUALITY_SPECS: Record<ChordQuality, QualitySpec> = {
  // Dominant 7 — the workhorse of major blues (I7 / IV7 / V7).
  dom7: {
    suffix: "7",
    chordIntervals: [0, 4, 7, 10],
  },
  // Minor 7 — i / iv of a minor blues.
  min7: {
    suffix: "m",
    chordIntervals: [0, 3, 7, 10],
  },
  // Plain major triad — the bVI chord of a minor blues.
  maj: {
    suffix: "",
    chordIntervals: [0, 4, 7],
  },
};

// Sharp spelling keeps key labels simple and unambiguous for a jam tool.
const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F",
  "F#", "G", "G#", "A", "A#", "B",
] as const;

export type BluesKey = (typeof NOTE_NAMES)[number];

export const BLUES_KEYS: readonly BluesKey[] = NOTE_NAMES;

// A bar references a scale degree (semitone offset from the key root) plus a
// chord quality and a roman-numeral tag for labelling.
type BarSpec = {
  roman: string;
  rootOffset: number;
  quality: ChordQuality;
};

const I7: BarSpec = { roman: "I", rootOffset: 0, quality: "dom7" };
const IV7: BarSpec = { roman: "IV", rootOffset: 5, quality: "dom7" };
const V7: BarSpec = { roman: "V", rootOffset: 7, quality: "dom7" };
const im: BarSpec = { roman: "i", rootOffset: 0, quality: "min7" };
const ivm: BarSpec = { roman: "iv", rootOffset: 5, quality: "min7" };
const bVI: BarSpec = { roman: "bVI", rootOffset: 8, quality: "maj" };

export type BluesProgression = {
  id: BluesProgressionId;
  label: string;
  bars: BarSpec[];
};

// All forms have a bar count divisible by 4 so the grid stays 4 columns wide
// with a whole number of rows (8 -> 2, 12 -> 3, 16 -> 4).
export const BLUES_PROGRESSIONS: readonly BluesProgression[] = [
  {
    id: "twelve-bar",
    label: "12 Bar",
    // Slow change: bar 2 stays on I.
    bars: [I7, I7, I7, I7, IV7, IV7, I7, I7, V7, IV7, I7, V7],
  },
  {
    id: "twelve-bar-quick-change",
    label: "12 Bar Fast Change",
    // Quick change: IV in bar 2.
    bars: [I7, IV7, I7, I7, IV7, IV7, I7, I7, V7, IV7, I7, V7],
  },
  {
    id: "sixteen-bar",
    label: "16 Bar",
    // 12-bar form with the IV–I section doubled.
    bars: [
      I7, I7, I7, I7, IV7, IV7, I7, I7,
      IV7, IV7, I7, I7, V7, IV7, I7, V7,
    ],
  },
  {
    id: "eight-bar",
    label: "8 Bar",
    // Key-to-the-Highway style 8-bar blues.
    bars: [I7, V7, IV7, IV7, I7, V7, I7, V7],
  },
  {
    id: "minor-blues",
    label: "Minor Blues",
    // i–iv–i–i / iv–iv–i–i / bVI–V–i–V.
    bars: [im, ivm, im, im, ivm, ivm, im, im, bVI, V7, im, V7],
  },
];

export function getProgression(id: BluesProgressionId): BluesProgression {
  return (
    BLUES_PROGRESSIONS.find((progression) => progression.id === id) ??
    BLUES_PROGRESSIONS[0]!
  );
}

export function keyToPitchClass(key: BluesKey): number {
  const index = NOTE_NAMES.indexOf(key);
  return index === -1 ? 0 : index;
}

function noteName(pitchClass: number): BluesKey {
  return NOTE_NAMES[((pitchClass % 12) + 12) % 12]!;
}

// --- Bass styles -------------------------------------------------------

// The groove feel a bass style implies, used by the scheduler to place
// off-beats and shape the drum pattern.
//  - "straight": even eighths, driving rock backbeat
//  - "shuffle": swung eighths, classic boogie/Texas-shuffle feel
//  - "half": half-time two-feel (kick on 1, snare on 3, sparse bass)
export type BassFeel = "straight" | "shuffle" | "half";

export type BassStyleId =
  | "root-pump"
  | "octave-pump"
  | "box"
  | "boogie"
  | "blues-riff"
  | "pentatonic"
  | "two-feel"
  | "syncopated-push"
  | "slow-shuffle"
  | "boogie-drone"
  | "walking-blues"
  | "turnaround-lick"
  | "rolling-shuffle"
  | "half-time-swagger"
  | "tight-pocket"
  | "hard-stomp"
  | "deep-groove";

export type BassStyle = {
  id: BassStyleId;
  label: string;
  feel: BassFeel;
};

export const BASS_STYLES: readonly BassStyle[] = [
  { id: "root-pump", label: "Root Pump", feel: "straight" },
  { id: "octave-pump", label: "Octave Pump", feel: "straight" },
  { id: "box", label: "Box Groove", feel: "shuffle" },
  { id: "boogie", label: "Boogie Walk", feel: "shuffle" },
  { id: "blues-riff", label: "Blues Riff", feel: "straight" },
  { id: "pentatonic", label: "Pentatonic Climb", feel: "straight" },
  { id: "two-feel", label: "Two-Feel", feel: "half" },
  { id: "syncopated-push", label: "Syncopated Push", feel: "straight" },
  { id: "slow-shuffle", label: "Slow Shuffle", feel: "shuffle" },
  { id: "boogie-drone", label: "Boogie Drone", feel: "shuffle" },
  { id: "walking-blues", label: "Walking Blues", feel: "straight" },
  { id: "turnaround-lick", label: "Turnaround Lick", feel: "straight" },
  { id: "rolling-shuffle", label: "Rolling Shuffle", feel: "shuffle" },
  { id: "half-time-swagger", label: "Half-Time Swagger", feel: "half" },
  // Restrained / hard / slightly groovy — built for a tight ~140bpm pocket.
  // Straight feel (no swing bounce), root-anchored, lots of space.
  { id: "tight-pocket", label: "Tight Pocket", feel: "straight" },
  { id: "hard-stomp", label: "Hard Stomp", feel: "straight" },
  { id: "deep-groove", label: "Deep Groove", feel: "straight" },
];

export function getBassStyle(id: BassStyleId): BassStyle {
  return BASS_STYLES.find((style) => style.id === id) ?? BASS_STYLES[0]!;
}

// One fully-resolved bar: everything the audio scheduler and grid renderer need.
export type ResolvedBar = {
  roman: string;
  // Display label, e.g. "C7", "Fm", "Ab".
  label: string;
  // Root pitch class (0-11) of the chord.
  rootPitchClass: number;
  // Absolute MIDI notes for comping voicing.
  chordMidi: number[];
  // Eight-slot eighth-note grid of bass MIDI values for the active bass style.
  // `null` is a rest. The last sounding slot leads into the next bar's chord;
  // filled in by resolveProgression with next-bar context.
  bassLine: (number | null)[];
};

// Octave anchors keep the bass low and the chord comping clearly above it (two
// octaves up) so the comp never masks against the bass / octave-pump notes.
const BASS_ROOT_MIDI = 36; // C2
const CHORD_ROOT_MIDI = 60; // C4

// Intermediate bar resolution before the bass riff is stitched across bars.
type BarSeed = ResolvedBar & {
  bassRoot: number;
  // Chord third interval (3 for minor, 4 for major/dominant).
  thirdInterval: number;
};

function seedBar(bar: BarSpec, key: BluesKey): BarSeed {
  const keyPc = keyToPitchClass(key);
  const rootPitchClass = (keyPc + bar.rootOffset) % 12;
  const spec = QUALITY_SPECS[bar.quality];
  const bassRoot = BASS_ROOT_MIDI + keyPc + bar.rootOffset;
  const chordRoot = CHORD_ROOT_MIDI + keyPc + bar.rootOffset;
  return {
    roman: bar.roman,
    label: `${noteName(rootPitchClass)}${spec.suffix}`,
    rootPitchClass,
    chordMidi: spec.chordIntervals.map((interval) => chordRoot + interval),
    bassLine: [],
    bassRoot,
    thirdInterval: spec.chordIntervals[1] ?? 4,
  };
}

// Chromatic leading tone a half step below the next chord root, folded back
// into the current bass octave so the line never leaps.
function approachNote(bassRoot: number, nextRoot: number): number {
  let approach = nextRoot - 1;
  while (approach - bassRoot > 7) approach -= 12;
  while (approach - bassRoot < -5) approach += 12;
  return approach;
}

// Build the 8-slot eighth-note bass grid for one bar in the chosen style.
// Blues-scale degrees are taken from the root: b3=+3, 3=+third, 4=+5, #4=+6,
// 5=+7, 6=+9, b7=+10, octave=+12.
function buildBassLine(
  styleId: BassStyleId,
  seed: BarSeed,
  nextRoot: number
): (number | null)[] {
  const r = seed.bassRoot;
  const third = r + seed.thirdInterval;
  const b3 = r + 3;
  const fourth = r + 5;
  const sharp4 = r + 6;
  const fifth = r + 7;
  const sixth = r + 9;
  const b7 = r + 10;
  const octave = r + 12;
  const app = approachNote(r, nextRoot);

  switch (styleId) {
    // Relentless root eighths, lift to the fifth, chromatic lead-in.
    case "root-pump":
      return [r, r, r, r, r, r, fifth, app];
    // Root on the beat, octave on the "and".
    case "octave-pump":
      return [r, octave, r, octave, r, octave, r, app];
    // Texas "box": root–5–b7–octave, twice per bar.
    case "box":
      return [r, fifth, b7, octave, r, fifth, b7, app];
    // Boogie-woogie walk: 1–3–5–6–b7–6–5 then lead into the change.
    case "boogie":
      return [r, third, fifth, sixth, b7, sixth, fifth, app];
    // Unison blues riff with the b3→3 hammer and a b7 tag.
    case "blues-riff":
      return [r, r, b3, third, fifth, r, b7, app];
    // Blues-scale climb (1–b3–4–#4–5–b7) up into the change.
    case "pentatonic":
      return [r, b3, fourth, sharp4, fifth, b7, octave, app];
    // Half-time two-feel: root on 1, fifth on 3 (rest of the grid is silent).
    case "two-feel":
      return [r, null, null, null, fifth, null, null, null];
    // Syncopated push: anticipates beat 3 via the "and" of 2.
    case "syncopated-push":
      return [r, null, r, r, null, fifth, r, app];
    // Slow shuffle: sparse and heavy — root, root–5, a bluesy b7→5, fill out.
    case "slow-shuffle":
      return [r, null, r, fifth, null, b7, fifth, app];
    // Boogie drone: hypnotic root pump with a swung 5–6–b7 lilt, re-rooting.
    case "boogie-drone":
      return [r, fifth, sixth, b7, r, fifth, sixth, app];
    // Walking blues: busy descending blues-scale run that resolves up.
    case "walking-blues":
      return [r, b7, sixth, fifth, fourth, b3, r, app];
    // Turnaround lick: steady root pulse capped by a pentatonic fill (5–b7–8).
    case "turnaround-lick":
      return [r, r, r, r, fifth, b7, octave, app];
    // Rolling shuffle: bouncing root–5 then root–b7 gallop.
    case "rolling-shuffle":
      return [r, fifth, r, fifth, r, b7, fifth, app];
    // Half-time swagger: laid-back root on 1, a b7 pickup into a fifth on 3.
    case "half-time-swagger":
      return [r, null, null, b7, fifth, null, null, null];
    // Tight pocket: hard downbeat, an anticipated root on the "and" of 2 that
    // pulls into a planted root on 3, then space. The push gives the groove
    // without any bounce; the wide rests keep it restrained.
    case "tight-pocket":
      return [r, null, null, r, r, null, null, app];
    // Hard stomp: planted quarter-note roots on 1 and 2, a syncopated b7 grind
    // on the "and" of 3 for blues grit, then a hard root on 4. Driving but
    // root-locked — no melodic fluff, no swing.
    case "hard-stomp":
      return [r, null, r, null, null, b7, r, app];
    // Deep groove: spacious off-beat roots on the "and" of 2 and the "and" of 3
    // (the funk-blues pocket) landing a low fifth on 4. Sparse, syncopated, dark.
    case "deep-groove":
      return [r, null, null, r, null, r, fifth, app];
    default:
      return [r, r, r, r, r, r, fifth, app];
  }
}

export function resolveBar(
  bar: BarSpec,
  key: BluesKey,
  styleId: BassStyleId = "root-pump"
): ResolvedBar {
  const seed = seedBar(bar, key);
  // Standalone resolve: lead back into the same chord root.
  seed.bassLine = buildBassLine(styleId, seed, seed.bassRoot);
  return stripSeed(seed);
}

function stripSeed(seed: BarSeed): ResolvedBar {
  const { bassRoot, thirdInterval, ...bar } = seed;
  void bassRoot;
  void thirdInterval;
  return bar;
}

export function resolveProgression(
  id: BluesProgressionId,
  key: BluesKey,
  styleId: BassStyleId = "root-pump"
): ResolvedBar[] {
  const seeds = getProgression(id).bars.map((bar) => seedBar(bar, key));
  return seeds.map((seed, index) => {
    const next = seeds[(index + 1) % seeds.length]!;
    seed.bassLine = buildBassLine(styleId, seed, next.bassRoot);
    return stripSeed(seed);
  });
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Grid is always 4 columns; rows follow from the bar count.
export function gridRowsForBarCount(barCount: number): number {
  return Math.ceil(barCount / 4);
}
