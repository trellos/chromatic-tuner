const SHARP_LABELS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLAT_LABELS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;
const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11] as const;
const MODE_NAMES = ["Ionian", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Aeolian", "Locrian"] as const;

export type NotationPreference = "sharp" | "flat";

type KeySpelling = {
  tonicPitchClass: number;
  label: string;
  scaleLabels: [string, string, string, string, string, string, string];
  useFlatsForChromatic: boolean;
};

const MAJOR_KEY_SPELLINGS: KeySpelling[] = [
  { tonicPitchClass: 0, label: "C", scaleLabels: ["C", "D", "E", "F", "G", "A", "B"], useFlatsForChromatic: false },
  { tonicPitchClass: 1, label: "Db", scaleLabels: ["Db", "Eb", "F", "Gb", "Ab", "Bb", "C"], useFlatsForChromatic: true },
  { tonicPitchClass: 2, label: "D", scaleLabels: ["D", "E", "F#", "G", "A", "B", "C#"], useFlatsForChromatic: false },
  { tonicPitchClass: 3, label: "Eb", scaleLabels: ["Eb", "F", "G", "Ab", "Bb", "C", "D"], useFlatsForChromatic: true },
  { tonicPitchClass: 4, label: "E", scaleLabels: ["E", "F#", "G#", "A", "B", "C#", "D#"], useFlatsForChromatic: false },
  { tonicPitchClass: 5, label: "F", scaleLabels: ["F", "G", "A", "Bb", "C", "D", "E"], useFlatsForChromatic: true },
  { tonicPitchClass: 6, label: "F#", scaleLabels: ["F#", "G#", "A#", "B", "C#", "D#", "E#"], useFlatsForChromatic: false },
  { tonicPitchClass: 7, label: "G", scaleLabels: ["G", "A", "B", "C", "D", "E", "F#"], useFlatsForChromatic: false },
  { tonicPitchClass: 8, label: "Ab", scaleLabels: ["Ab", "Bb", "C", "Db", "Eb", "F", "G"], useFlatsForChromatic: true },
  { tonicPitchClass: 9, label: "A", scaleLabels: ["A", "B", "C#", "D", "E", "F#", "G#"], useFlatsForChromatic: false },
  { tonicPitchClass: 10, label: "Bb", scaleLabels: ["Bb", "C", "D", "Eb", "F", "G", "A"], useFlatsForChromatic: true },
  { tonicPitchClass: 11, label: "B", scaleLabels: ["B", "C#", "D#", "E", "F#", "G#", "A#"], useFlatsForChromatic: false },
];

export type KeyFinderCandidate = {
  id: string;
  tonic: number;
  label: string;
  confidence: number;
  matched: number[];
  outliers: number[];
  scale: number[];
  scaleLabels: string[];
  useFlatsForChromatic: boolean;
};

export type KeyFinderRankedResult = {
  candidates: KeyFinderCandidate[];
};

export type KeyFinderScoreOptions = {
  outlierPenalty?: number;
  notation?: NotationPreference;
};

function wrapPitchClass(value: number): number {
  return ((value % 12) + 12) % 12;
}

function pitchClassLabel(pitchClass: number, notation: NotationPreference): string {
  const table = notation === "flat" ? FLAT_LABELS : SHARP_LABELS;
  return table[wrapPitchClass(pitchClass)] ?? "C";
}

function sortedUnique(input: number[]): number[] {
  return [...new Set(input.map(wrapPitchClass))].sort((a, b) => a - b);
}

function buildMajorScale(tonic: number): number[] {
  return MAJOR_SCALE_INTERVALS.map((interval) => wrapPitchClass(tonic + interval));
}

export function buildModeHintsForTonic(tonic: number, notation: NotationPreference): string[] {
  const key = MAJOR_KEY_SPELLINGS.find((item) => item.tonicPitchClass === tonic);
  if (!key) return [];
  return key.scaleLabels.slice(1).map((label, index) => `${label} ${MODE_NAMES[index + 1]}`);
}

export function rankKeyFinderCandidates(
  selectedPitchClasses: number[],
  options: KeyFinderScoreOptions = {}
): KeyFinderRankedResult {
  const notation = options.notation ?? "sharp";
  const outlierPenalty = options.outlierPenalty ?? 35;
  const selected = sortedUnique(selectedPitchClasses);
  if (selected.length === 0) {
    return { candidates: [] };
  }

  const candidates: KeyFinderCandidate[] = [];
  for (const key of MAJOR_KEY_SPELLINGS) {
    const scale = buildMajorScale(key.tonicPitchClass);
    const matched = selected.filter((pitchClass) => scale.includes(pitchClass));
    const outliers = selected.filter((pitchClass) => !scale.includes(pitchClass));
    const coverage = matched.length / selected.length;
    const penalty = outliers.length / selected.length;
    const confidence = Math.max(0, Math.min(100, Math.round((coverage * 100) - (penalty * outlierPenalty))));

    candidates.push({
      id: String(key.tonicPitchClass),
      tonic: key.tonicPitchClass,
      label: key.label,
      confidence,
      matched,
      outliers,
      scale,
      scaleLabels: [...key.scaleLabels],
      useFlatsForChromatic: key.useFlatsForChromatic,
    });
  }

  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (b.matched.length !== a.matched.length) return b.matched.length - a.matched.length;
    return a.id.localeCompare(b.id);
  });

  return { candidates };
}

export function normalizePitchClassSet(values: number[]): number[] {
  return sortedUnique(values);
}

export function chromaticLabelForKey(pitchClass: number, candidate: KeyFinderCandidate): string {
  return pitchClassLabel(pitchClass, candidate.useFlatsForChromatic ? "flat" : "sharp");
}
