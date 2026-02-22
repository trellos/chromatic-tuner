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

export type DisplayType = "scale" | "chord";

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

export type CharacteristicType = ScaleType | ChordType;

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

const NOTE_TO_SEMITONE: Record<NoteName, number> = {
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

export function getIntervals(display: DisplayType, characteristic: CharacteristicType): readonly number[] {
  if (display === "scale") {
    return isScaleType(characteristic) ? SCALE_INTERVALS[characteristic] : SCALE_INTERVALS.minor;
  }
  return isChordType(characteristic) ? CHORD_INTERVALS[characteristic] : CHORD_INTERVALS.minor;
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
