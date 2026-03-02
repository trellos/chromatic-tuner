const SHARP_LABELS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLAT_LABELS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;
const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11] as const;
const MODE_NAMES = ["Ionian", "Dorian", "Phrygian", "Lydian", "Mixolydian", "Aeolian", "Locrian"] as const;

export type NotationPreference = "sharp" | "flat";

export type KeyFinderCandidate = {
  id: string;
  tonic: number;
  // Display label is intentionally tonic-only (`C`, `F#`, `Bb`) to avoid
  // mode clutter in the results list.
  label: string;
  confidence: number;
  matched: number[];
  outliers: number[];
  scale: number[];
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
  const scale = buildMajorScale(tonic);
  return scale
    .slice(1)
    .map((pitchClass, index) => `${pitchClassLabel(pitchClass, notation)} ${MODE_NAMES[index + 1]}`);
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
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const scale = buildMajorScale(tonic);
    const matched = selected.filter((pitchClass) => scale.includes(pitchClass));
    const outliers = selected.filter((pitchClass) => !scale.includes(pitchClass));
    const coverage = matched.length / selected.length;
    const penalty = outliers.length / selected.length;
    const confidence = Math.max(0, Math.min(100, Math.round((coverage * 100) - (penalty * outlierPenalty))));

    candidates.push({
      id: String(tonic),
      tonic,
      label: pitchClassLabel(tonic, notation),
      confidence,
      matched,
      outliers,
      scale,
    });
  }

  // Deterministic ordering keeps result rows stable for repeated input.
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
