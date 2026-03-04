import { describe, it, expect } from "vitest";
import {
  rankKeyFinderCandidates,
  normalizePitchClassSet,
  buildModeHintsForTonic,
  chromaticLabelForKey,
} from "../../src/modes/key-finder-logic.js";

describe("rankKeyFinderCandidates", () => {
  it("returns empty candidates for no input", () => {
    const result = rankKeyFinderCandidates([]);
    expect(result.candidates).toHaveLength(0);
  });

  it("ranks C major first when given C major notes", () => {
    // C=0, D=2, E=4, F=5, G=7, A=9, B=11
    const result = rankKeyFinderCandidates([0, 2, 4, 5, 7, 9, 11]);
    expect(result.candidates[0]?.label).toBe("C");
    expect(result.candidates[0]?.confidence).toBe(100);
  });

  it("identifies G major from its notes", () => {
    // G=7, A=9, B=11, C=0, D=2, E=4, F#=6
    const result = rankKeyFinderCandidates([7, 9, 11, 0, 2, 4, 6]);
    expect(result.candidates[0]?.label).toBe("G");
    expect(result.candidates[0]?.confidence).toBe(100);
  });

  it("produces lower confidence when outlier notes are present", () => {
    // C major notes + F# (outlier)
    const perfect = rankKeyFinderCandidates([0, 2, 4, 5, 7, 9, 11]);
    const withOutlier = rankKeyFinderCandidates([0, 2, 4, 5, 6, 7, 9, 11]);
    const cPerfect = perfect.candidates.find((c) => c.label === "C")?.confidence ?? 0;
    const cWithOutlier = withOutlier.candidates.find((c) => c.label === "C")?.confidence ?? 0;
    expect(cWithOutlier).toBeLessThan(cPerfect);
  });

  it("deduplicates and wraps pitch classes", () => {
    // 12 and 0 are the same pitch class (C)
    const result = rankKeyFinderCandidates([0, 12, 24]);
    // Should not increase the matched count by treating them as separate notes
    expect(result.candidates[0]?.matched).toHaveLength(1);
  });

  it("returns 12 candidates (one per key)", () => {
    const result = rankKeyFinderCandidates([0]);
    expect(result.candidates).toHaveLength(12);
  });

  it("sorts candidates by confidence descending", () => {
    const result = rankKeyFinderCandidates([0, 2, 4, 5, 7]);
    const confidences = result.candidates.map((c) => c.confidence);
    for (let i = 1; i < confidences.length; i++) {
      expect(confidences[i]).toBeLessThanOrEqual(confidences[i - 1] ?? 100);
    }
  });

  it("uses flat notation for flat keys", () => {
    // Bb major: Bb=10, C=0, D=2, Eb=3, F=5, G=7, A=9
    const result = rankKeyFinderCandidates([10, 0, 2, 3, 5, 7, 9]);
    const bb = result.candidates.find((c) => c.label === "Bb");
    expect(bb?.useFlatsForChromatic).toBe(true);
  });
});

describe("normalizePitchClassSet", () => {
  it("removes duplicates and sorts", () => {
    expect(normalizePitchClassSet([5, 0, 5, 2])).toEqual([0, 2, 5]);
  });

  it("wraps values to 0-11 range", () => {
    expect(normalizePitchClassSet([12, 14])).toEqual([0, 2]);
  });
});

describe("buildModeHintsForTonic", () => {
  it("returns 6 mode hints for a known tonic", () => {
    const hints = buildModeHintsForTonic(0, "sharp"); // C
    expect(hints).toHaveLength(6);
  });

  it("first hint for C tonic is D Dorian", () => {
    const hints = buildModeHintsForTonic(0, "sharp");
    expect(hints[0]).toBe("D Dorian");
  });

  it("returns empty for an unrecognized tonic", () => {
    const hints = buildModeHintsForTonic(99, "sharp");
    expect(hints).toHaveLength(0);
  });
});

describe("chromaticLabelForKey", () => {
  it("uses sharps for a sharp key", () => {
    const result = rankKeyFinderCandidates([0]);
    const cKey = result.candidates.find((c) => c.label === "C")!;
    // F# is pitch class 6
    expect(chromaticLabelForKey(6, cKey)).toBe("F#");
  });

  it("uses flats for a flat key", () => {
    const result = rankKeyFinderCandidates([10]);
    const bbKey = result.candidates.find((c) => c.label === "Bb")!;
    // Bb is pitch class 10
    expect(chromaticLabelForKey(10, bbKey)).toBe("Bb");
  });
});
