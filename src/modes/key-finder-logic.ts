const SHARP_LABELS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLAT_LABELS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;
const MODE_INTERVALS = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
} as const;

export type NotationPreference = "sharp" | "flat";

export type ModeName = keyof typeof MODE_INTERVALS;

export type KeyFinderCandidate = {
  id: string;
  tonic: number;
  mode: ModeName;
  label: string;
  confidence: number;
  confidenceLabel: "Strong match" | "Possible" | "Loose fit";
  coverageRatio: number;
  matched: number[];
  outliers: number[];
  scale: number[];
  emphasizedScaleText: string;
};

export type KeyFinderRankedResult = {
  candidates: KeyFinderCandidate[];
  isAmbiguous: boolean;
  lowData: boolean;
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

function scoreLabel(value: number): "Strong match" | "Possible" | "Loose fit" {
  if (value >= 80) return "Strong match";
  if (value >= 55) return "Possible";
  return "Loose fit";
}

function buildScale(tonic: number, mode: ModeName): number[] {
  return MODE_INTERVALS[mode].map((interval) => wrapPitchClass(tonic + interval));
}

function modeDisplay(mode: ModeName): string {
  switch (mode) {
    case "ionian":
      return "Ionian";
    case "dorian":
      return "Dorian";
    case "phrygian":
      return "Phrygian";
    case "lydian":
      return "Lydian";
    case "mixolydian":
      return "Mixolydian";
    case "aeolian":
      return "Aeolian";
    case "locrian":
      return "Locrian";
  }
}

function tonicDisplay(mode: ModeName): string {
  if (mode === "ionian") return "Major";
  if (mode === "aeolian") return "Minor";
  return modeDisplay(mode);
}

export function rankKeyFinderCandidates(
  selectedPitchClasses: number[],
  options: KeyFinderScoreOptions = {}
): KeyFinderRankedResult {
  const notation = options.notation ?? "sharp";
  const outlierPenalty = options.outlierPenalty ?? 35;
  const selected = sortedUnique(selectedPitchClasses);
  if (selected.length === 0) {
    return { candidates: [], isAmbiguous: false, lowData: true };
  }

  const candidates: KeyFinderCandidate[] = [];
  for (let tonic = 0; tonic < 12; tonic += 1) {
    (Object.keys(MODE_INTERVALS) as ModeName[]).forEach((mode) => {
      const scale = buildScale(tonic, mode);
      const matched = selected.filter((pc) => scale.includes(pc));
      const outliers = selected.filter((pc) => !scale.includes(pc));
      const coverage = matched.length / selected.length;
      const penalty = outliers.length / selected.length;
      const confidence = Math.max(0, Math.min(100, Math.round((coverage * 100) - (penalty * outlierPenalty))));
      const tonicLabel = pitchClassLabel(tonic, notation);
      const emphasizedScaleText = scale
        .map((pc, idx) => {
          const label = pitchClassLabel(pc, notation);
          return idx === 0 ? `*${label}*` : label;
        })
        .join(" ");

      candidates.push({
        id: `${tonic}-${mode}`,
        tonic,
        mode,
        label: `${tonicLabel} ${tonicDisplay(mode)} (${modeDisplay(mode)})`,
        confidence,
        confidenceLabel: scoreLabel(confidence),
        coverageRatio: coverage,
        matched,
        outliers,
        scale,
        emphasizedScaleText,
      });
    });
  }

  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (b.matched.length !== a.matched.length) return b.matched.length - a.matched.length;
    return a.id.localeCompare(b.id);
  });

  const top = candidates[0]?.confidence ?? 0;
  const second = candidates[1]?.confidence ?? 0;
  return {
    candidates,
    isAmbiguous: top > 0 && Math.abs(top - second) <= 5,
    lowData: selected.length < 3,
  };
}

export function formatPitchClassList(values: number[], notation: NotationPreference): string {
  return values.map((pc) => pitchClassLabel(pc, notation)).join(" ");
}

export function normalizePitchClassSet(values: number[]): number[] {
  return sortedUnique(values);
}
