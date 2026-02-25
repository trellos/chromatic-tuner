export type NoteName =
  | "A"
  | "A#"
  | "B"
  | "C"
  | "C#"
  | "D"
  | "D#"
  | "E"
  | "F"
  | "F#"
  | "G"
  | "G#";

export type DisplayType = "scale" | "chord" | "key";
export type KeyModeType =
  | "ionian-major"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "aeolian-minor"
  | "locrian";

export type ScaleType =
  | "major"
  | "minor"
  | "minor-pentatonic"
  | "major-pentatonic"
  | "blues";

export type ChordType =
  | "major"
  | "minor"
  | "power"
  | "triad"
  | "seventh"
  | "augmented"
  | "suspended-second"
  | "suspended-fourth"
  | "ninth";

export type CharacteristicType = ScaleType | ChordType | KeyModeType;

export type AnnotationType = "notes" | "degrees";

export type FretboardState = {
  root: NoteName;
  display: DisplayType;
  characteristic: CharacteristicType;
  annotation: AnnotationType;
};

export type FretboardDot = {
  stringIndex: number;
  fret: number;
  note: NoteName;
  degree: string;
  midi: number;
};

const CHROMATIC_BY_SEMITONE = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export const NOTE_TO_SEMITONE: Record<NoteName, number> = {
  A: 9,
  "A#": 10,
  B: 11,
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
};

// Default fretboard state: C major scale with note annotations.
export const FRETBOARD_DEFAULT_STATE: FretboardState = {
  root: "C",
  display: "scale",
  characteristic: "major",
  annotation: "notes",
};

const SCALE_INTERVALS: Record<ScaleType, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  "minor-pentatonic": [0, 3, 5, 7, 10],
  "major-pentatonic": [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
};

const CHORD_INTERVALS: Record<ChordType, readonly number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  power: [0, 7],
  triad: [0, 4, 7],
  seventh: [0, 4, 7, 10],
  augmented: [0, 4, 8],
  "suspended-second": [0, 2, 7],
  "suspended-fourth": [0, 5, 7],
  ninth: [0, 2, 4, 7, 10],
};

const KEY_MODE_INTERVALS: Record<KeyModeType, readonly number[]> = {
  "ionian-major": [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  "aeolian-minor": [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

const TRIAD_STRING_GROUP_BY_STRING_INDEX: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [1, 2, 3],
  [2, 3, 4],
  [3, 4, 5],
  [3, 4, 5],
  [3, 4, 5],
];

const DEGREE_BY_INTERVAL: Record<number, string> = {
  0: "1",
  1: "b2",
  2: "2",
  3: "b3",
  4: "3",
  5: "4",
  6: "b5",
  7: "5",
  8: "b6",
  9: "6",
  10: "b7",
  11: "7",
};

// Standard tuning low E -> high E, rendered left-to-right in this UI.
const OPEN_STRING_SEMITONES = [4, 9, 2, 7, 11, 4] as const;
const OPEN_STRING_MIDI = [40, 45, 50, 55, 59, 64] as const;

export const MAX_FRET = 12;

function normalizeSemitone(value: number): number {
  return ((value % 12) + 12) % 12;
}

export function normalizeChordType(raw: string): ChordType | null {
  const normalized = raw.trim().toLowerCase();
  const map: Record<string, ChordType> = {
    major: "major",
    minor: "minor",
    power: "power",
    triad: "triad",
    seventh: "seventh",
    augmented: "augmented",
    sus2: "suspended-second",
    "suspended second": "suspended-second",
    "suspended-second": "suspended-second",
    sus4: "suspended-fourth",
    "suspended fourth": "suspended-fourth",
    "suspended-fourth": "suspended-fourth",
    ninth: "ninth",
  };
  return map[normalized] ?? null;
}


function isScaleType(value: string): value is ScaleType {
  return value in SCALE_INTERVALS;
}

function isChordType(value: string): value is ChordType {
  return value in CHORD_INTERVALS;
}

export function normalizeKeyModeType(raw: string): KeyModeType | null {
  const normalized = raw.trim().toLowerCase();
  const map: Record<string, KeyModeType> = {
    ionian: "ionian-major",
    "ionian-major": "ionian-major",
    major: "ionian-major",
    dorian: "dorian",
    phrygian: "phrygian",
    lydian: "lydian",
    mixolydian: "mixolydian",
    aeolian: "aeolian-minor",
    "aeolian-minor": "aeolian-minor",
    minor: "aeolian-minor",
    locrian: "locrian",
  };
  return map[normalized] ?? null;
}

function isKeyModeType(value: string): value is KeyModeType {
  return value in KEY_MODE_INTERVALS;
}

export function getIntervals(display: DisplayType, characteristic: CharacteristicType): readonly number[] {
  if (display === "scale") {
    return isScaleType(characteristic) ? SCALE_INTERVALS[characteristic] : SCALE_INTERVALS.minor;
  }
  if (display === "chord") {
    return isChordType(characteristic) ? CHORD_INTERVALS[characteristic] : CHORD_INTERVALS.minor;
  }
  return isKeyModeType(characteristic) ? KEY_MODE_INTERVALS[characteristic] : KEY_MODE_INTERVALS["ionian-major"];
}

export function getFretboardMidiAtPosition(stringIndex: number, fret: number): number {
  const clampedStringIndex = Math.max(0, Math.min(OPEN_STRING_MIDI.length - 1, stringIndex));
  const openMidi = OPEN_STRING_MIDI[clampedStringIndex] ?? OPEN_STRING_MIDI[0] ?? 40;
  return Math.max(0, openMidi + fret);
}

export function getFretboardDots(state: FretboardState): FretboardDot[] {
  const rootSemitone = NOTE_TO_SEMITONE[state.root];
  const intervals = getIntervals(state.display, state.characteristic);
  const intervalSet = new Set(intervals.map((interval) => normalizeSemitone(interval)));
  const dots: FretboardDot[] = [];

  for (let stringIndex = 0; stringIndex < OPEN_STRING_SEMITONES.length; stringIndex += 1) {
    const openSemitone = OPEN_STRING_SEMITONES[stringIndex] ?? 0;
    for (let fret = 0; fret <= MAX_FRET; fret += 1) {
      const noteSemitone = normalizeSemitone(openSemitone + fret);
      const intervalFromRoot = normalizeSemitone(noteSemitone - rootSemitone);
      if (!intervalSet.has(intervalFromRoot)) continue;
      dots.push({
        stringIndex,
        fret,
        note: CHROMATIC_BY_SEMITONE[noteSemitone] ?? "C",
        degree: DEGREE_BY_INTERVAL[intervalFromRoot] ?? "",
        midi: getFretboardMidiAtPosition(stringIndex, fret),
      });
    }
  }

  return dots;
}

export type FretboardPlaybackTarget = {
  midi: number;
  stringIndex: number;
  isRoot?: boolean;
};

function getTriadIntervals(chordType: ChordType): readonly [number, number, number] {
  const intervals = [...new Set(CHORD_INTERVALS[chordType].map((interval) => normalizeSemitone(interval)))].sort(
    (a, b) => a - b
  );
  const second = intervals.find((interval) => interval > 0) ?? 7;
  const third = intervals.find((interval) => interval > second) ?? 12;
  return [0, second, third];
}

function getMidiAtOrAbove(options: {
  targetPitchClass: number;
  minimumMidi: number;
  stringIndex: number;
}): number {
  const openMidi = OPEN_STRING_MIDI[options.stringIndex] ?? OPEN_STRING_MIDI[0] ?? 40;
  let candidate = openMidi;
  if (candidate < options.minimumMidi) {
    const semitoneDistance = options.minimumMidi - candidate;
    candidate += semitoneDistance;
  }

  const pitchOffset = normalizeSemitone(options.targetPitchClass - normalizeSemitone(candidate));
  return candidate + pitchOffset;
}

function getMidiAtOrBelow(options: {
  targetPitchClass: number;
  maximumMidi: number;
  stringIndex: number;
}): number {
  const upward = getMidiAtOrAbove({
    targetPitchClass: options.targetPitchClass,
    minimumMidi: 0,
    stringIndex: options.stringIndex,
  });
  if (upward <= options.maximumMidi) return upward;
  return upward - 12;
}

function getMidiNearest(options: {
  targetPitchClass: number;
  nearMidi: number;
  stringIndex: number;
}): number {
  const openMidi = OPEN_STRING_MIDI[options.stringIndex] ?? OPEN_STRING_MIDI[0] ?? 40;
  const maxVisibleMidi = openMidi + MAX_FRET;
  const visibleCandidates: number[] = [];
  for (let midi = openMidi; midi <= maxVisibleMidi; midi += 1) {
    if (normalizeSemitone(midi) === normalizeSemitone(options.targetPitchClass)) {
      visibleCandidates.push(midi);
    }
  }
  if (visibleCandidates.length > 0) {
    return visibleCandidates.reduce((best, candidate) => {
      const bestDistance = Math.abs(best - options.nearMidi);
      const candidateDistance = Math.abs(candidate - options.nearMidi);
      if (candidateDistance < bestDistance) return candidate;
      if (candidateDistance > bestDistance) return best;
      return candidate < best ? candidate : best;
    });
  }

  const above = getMidiAtOrAbove({
    targetPitchClass: options.targetPitchClass,
    minimumMidi: options.nearMidi,
    stringIndex: options.stringIndex,
  });
  const below = getMidiAtOrBelow({
    targetPitchClass: options.targetPitchClass,
    maximumMidi: options.nearMidi,
    stringIndex: options.stringIndex,
  });
  if (Math.abs(above - options.nearMidi) < Math.abs(below - options.nearMidi)) {
    return above;
  }
  return below;
}

export function getChordTapPlaybackTargets(options: {
  chordRoot: NoteName;
  characteristic: CharacteristicType;
  tappedMidi: number;
  tappedStringIndex: number;
}): FretboardPlaybackTarget[] {
  const chordType = isChordType(options.characteristic) ? options.characteristic : "major";
  const triadIntervals = getTriadIntervals(chordType);
  const chordRootSemitone = NOTE_TO_SEMITONE[options.chordRoot] ?? 0;
  const triadPitchClasses: [number, number, number] = [
    normalizeSemitone(chordRootSemitone + triadIntervals[0]),
    normalizeSemitone(chordRootSemitone + triadIntervals[1]),
    normalizeSemitone(chordRootSemitone + triadIntervals[2]),
  ];
  const tappedPitchClass = normalizeSemitone(options.tappedMidi);
  const tappedDegreeIndex = triadPitchClasses.findIndex((pitchClass) => pitchClass === tappedPitchClass);
  const degreeIndex = tappedDegreeIndex >= 0 ? tappedDegreeIndex : 0;

  const useLowerNeighborStrings = options.tappedStringIndex >= 4;
  const stringGroup: readonly [number, number, number] = useLowerNeighborStrings
    ? options.tappedStringIndex === 4
      ? [2, 3, 4]
      : [3, 4, 5]
    : ([
        options.tappedStringIndex,
        Math.min(5, options.tappedStringIndex + 1),
        Math.min(5, options.tappedStringIndex + 2),
      ] as const);
  const tappedPosition = useLowerNeighborStrings ? 2 : 0;
  const orderedPitchClasses: [number, number, number] =
    tappedPosition === 0
      ? [
          triadPitchClasses[(degreeIndex + 0) % 3] ?? triadPitchClasses[0],
          triadPitchClasses[(degreeIndex + 1) % 3] ?? triadPitchClasses[1],
          triadPitchClasses[(degreeIndex + 2) % 3] ?? triadPitchClasses[2],
        ]
      : [
          triadPitchClasses[(degreeIndex + 1) % 3] ?? triadPitchClasses[1],
          triadPitchClasses[(degreeIndex + 2) % 3] ?? triadPitchClasses[2],
          triadPitchClasses[(degreeIndex + 0) % 3] ?? triadPitchClasses[0],
        ];

  const result: FretboardPlaybackTarget[] = new Array(3);
  if (tappedPosition === 0) {
    const bassMidi = options.tappedMidi;
    const secondMidi = getMidiAtOrAbove({
      targetPitchClass: orderedPitchClasses[1],
      minimumMidi: bassMidi + 1,
      stringIndex: stringGroup[1] ?? 1,
    });
    const thirdMidi = getMidiAtOrAbove({
      targetPitchClass: orderedPitchClasses[2],
      minimumMidi: secondMidi + 1,
      stringIndex: stringGroup[2] ?? 2,
    });
    result[0] = { midi: bassMidi, stringIndex: stringGroup[0] ?? options.tappedStringIndex, isRoot: true };
    result[1] = { midi: secondMidi, stringIndex: stringGroup[1] ?? 1 };
    result[2] = { midi: thirdMidi, stringIndex: stringGroup[2] ?? 2 };
    return result;
  }

  const topMidi = options.tappedMidi;
  const middleMidi = getMidiAtOrBelow({
    targetPitchClass: orderedPitchClasses[1],
    maximumMidi: topMidi - 1,
    stringIndex: stringGroup[1] ?? 4,
  });
  const lowMidi = getMidiAtOrBelow({
    targetPitchClass: orderedPitchClasses[0],
    maximumMidi: middleMidi - 1,
    stringIndex: stringGroup[0] ?? 3,
  });
  result[0] = { midi: lowMidi, stringIndex: stringGroup[0] ?? 3 };
  result[1] = { midi: middleMidi, stringIndex: stringGroup[1] ?? 4 };
  result[2] = { midi: topMidi, stringIndex: stringGroup[2] ?? options.tappedStringIndex, isRoot: true };
  return result;
}

export function getKeyTapPlaybackTargets(options: {
  keyRoot: NoteName;
  keyMode: CharacteristicType;
  tappedMidi: number;
  tappedStringIndex: number;
}): FretboardPlaybackTarget[] {
  const mode = isKeyModeType(options.keyMode) ? options.keyMode : "ionian-major";
  const modeIntervals = KEY_MODE_INTERVALS[mode];
  const keyRootSemitone = NOTE_TO_SEMITONE[options.keyRoot] ?? 0;
  const tappedPitchClass = normalizeSemitone(options.tappedMidi);
  const tappedInterval = normalizeSemitone(tappedPitchClass - keyRootSemitone);
  const degreeIndex = modeIntervals.findIndex((interval) => interval === tappedInterval);
  if (degreeIndex < 0) {
    return [{ midi: options.tappedMidi, stringIndex: options.tappedStringIndex, isRoot: true }];
  }

  const thirdInterval = modeIntervals[(degreeIndex + 2) % 7] ?? 4;
  const fifthInterval = modeIntervals[(degreeIndex + 4) % 7] ?? 7;
  const rootPitchClass = tappedPitchClass;
  const thirdPitchClass = normalizeSemitone(keyRootSemitone + thirdInterval);
  const fifthPitchClass = normalizeSemitone(keyRootSemitone + fifthInterval);

  if (options.tappedStringIndex >= 4) {
    const strings: readonly [number, number, number] = [3, 4, 5];
    const pitchForString = new Map<number, number>();
    if (options.tappedStringIndex === 4) {
      pitchForString.set(3, fifthPitchClass);
      pitchForString.set(4, rootPitchClass);
      pitchForString.set(5, thirdPitchClass);
    } else {
      pitchForString.set(3, thirdPitchClass);
      pitchForString.set(4, fifthPitchClass);
      pitchForString.set(5, rootPitchClass);
    }

    return strings.map((stringIndex) => {
      if (stringIndex === options.tappedStringIndex) {
        return { midi: options.tappedMidi, stringIndex, isRoot: true };
      }
      const pitchClass = pitchForString.get(stringIndex) ?? rootPitchClass;
      return {
        midi: getMidiNearest({
          targetPitchClass: pitchClass,
          nearMidi: options.tappedMidi,
          stringIndex,
        }),
        stringIndex,
      };
    });
  }

  const stringGroup =
    TRIAD_STRING_GROUP_BY_STRING_INDEX[options.tappedStringIndex] ??
    TRIAD_STRING_GROUP_BY_STRING_INDEX[0] ??
    ([0, 1, 2] as const);
  const bassMidi = options.tappedMidi;
  const secondMidi = getMidiAtOrAbove({
    targetPitchClass: thirdPitchClass,
    minimumMidi: bassMidi + 1,
    stringIndex: stringGroup[1] ?? 1,
  });
  const thirdMidi = getMidiAtOrAbove({
    targetPitchClass: fifthPitchClass,
    minimumMidi: secondMidi + 1,
    stringIndex: stringGroup[2] ?? 2,
  });

  return [
    { midi: bassMidi, stringIndex: stringGroup[0] ?? options.tappedStringIndex, isRoot: true },
    { midi: secondMidi, stringIndex: stringGroup[1] ?? 1 },
    { midi: thirdMidi, stringIndex: stringGroup[2] ?? 2 },
  ];
}
