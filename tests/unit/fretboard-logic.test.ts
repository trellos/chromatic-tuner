import { describe, it, expect } from "vitest";
import {
  getFretboardDots,
  getFretboardMidiAtPosition,
  getIntervals,
  normalizeChordType,
  normalizeKeyModeType,
  getDiatonicHarmonyMidi,
  NOTE_TO_SEMITONE,
  FRETBOARD_DEFAULT_STATE,
  MAX_FRET,
} from "../../src/fretboard-logic.js";
import type { FretboardState } from "../../src/fretboard-logic.js";

describe("getFretboardMidiAtPosition", () => {
  it("returns open string MIDI for fret 0", () => {
    // Standard tuning: E2=40, A2=45, D3=50, G3=55, B3=59, E4=64
    expect(getFretboardMidiAtPosition(0, 0)).toBe(40); // low E
    expect(getFretboardMidiAtPosition(5, 0)).toBe(64); // high E
  });

  it("adds fret offset correctly", () => {
    expect(getFretboardMidiAtPosition(0, 5)).toBe(45); // low E + 5 frets = A
    expect(getFretboardMidiAtPosition(1, 5)).toBe(50); // A + 5 = D
  });

  it("clamps out-of-range string indices", () => {
    expect(getFretboardMidiAtPosition(-1, 0)).toBe(getFretboardMidiAtPosition(0, 0));
    expect(getFretboardMidiAtPosition(99, 0)).toBe(getFretboardMidiAtPosition(5, 0));
  });
});

describe("getFretboardDots", () => {
  it("returns dots for C major scale", () => {
    const state: FretboardState = { ...FRETBOARD_DEFAULT_STATE };
    const dots = getFretboardDots(state);
    expect(dots.length).toBeGreaterThan(0);
    // All dots should be notes in C major (C D E F G A B)
    const cMajorNotes = new Set(["C", "D", "E", "F", "G", "A", "B"]);
    for (const dot of dots) {
      expect(cMajorNotes.has(dot.note)).toBe(true);
    }
  });

  it("marks the root note with degree '1'", () => {
    const state: FretboardState = { ...FRETBOARD_DEFAULT_STATE, root: "G" };
    const dots = getFretboardDots(state);
    const roots = dots.filter((d) => d.degree === "1");
    expect(roots.length).toBeGreaterThan(0);
    for (const root of roots) {
      expect(root.note).toBe("G");
    }
  });

  it("returns only chord tones for chord display", () => {
    const state: FretboardState = {
      root: "A",
      display: "chord",
      characteristic: "major",
      annotation: "notes",
    };
    const dots = getFretboardDots(state);
    // A major chord = A, C#, E
    const allowedNotes = new Set(["A", "C#", "E"]);
    for (const dot of dots) {
      expect(allowedNotes.has(dot.note)).toBe(true);
    }
  });

  it("respects MAX_FRET boundary", () => {
    const state: FretboardState = { ...FRETBOARD_DEFAULT_STATE };
    const dots = getFretboardDots(state);
    for (const dot of dots) {
      expect(dot.fret).toBeGreaterThanOrEqual(0);
      expect(dot.fret).toBeLessThanOrEqual(MAX_FRET);
    }
  });

  it("covers all 6 strings", () => {
    const state: FretboardState = { ...FRETBOARD_DEFAULT_STATE };
    const dots = getFretboardDots(state);
    const stringIndices = new Set(dots.map((d) => d.stringIndex));
    expect(stringIndices.size).toBe(6);
  });

  it("pentatonic scale has fewer dots than major scale", () => {
    const major = getFretboardDots({ ...FRETBOARD_DEFAULT_STATE, characteristic: "major" });
    const pentatonic = getFretboardDots({ ...FRETBOARD_DEFAULT_STATE, characteristic: "major-pentatonic" });
    expect(pentatonic.length).toBeLessThan(major.length);
  });
});

describe("getIntervals", () => {
  it("returns 7 intervals for major scale", () => {
    expect(getIntervals("scale", "major")).toHaveLength(7);
  });

  it("returns 5 intervals for pentatonic scale", () => {
    expect(getIntervals("scale", "minor-pentatonic")).toHaveLength(5);
  });

  it("returns 3 intervals for power chord", () => {
    expect(getIntervals("chord", "power")).toHaveLength(2);
  });

  it("major scale starts on 0 and ends on 11", () => {
    const intervals = getIntervals("scale", "major");
    expect(intervals[0]).toBe(0);
    expect(intervals[intervals.length - 1]).toBe(11);
  });
});

describe("normalizeChordType", () => {
  it("normalizes sus2 alias", () => {
    expect(normalizeChordType("sus2")).toBe("suspended-second");
  });

  it("normalizes sus4 alias", () => {
    expect(normalizeChordType("sus4")).toBe("suspended-fourth");
  });

  it("returns null for unknown type", () => {
    expect(normalizeChordType("diminished")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(normalizeChordType("MAJOR")).toBe("major");
  });
});

describe("normalizeKeyModeType", () => {
  it("maps 'major' to ionian-major", () => {
    expect(normalizeKeyModeType("major")).toBe("ionian-major");
  });

  it("maps 'minor' to aeolian-minor", () => {
    expect(normalizeKeyModeType("minor")).toBe("aeolian-minor");
  });

  it("maps 'ionian' alias", () => {
    expect(normalizeKeyModeType("ionian")).toBe("ionian-major");
  });

  it("returns null for unknown mode", () => {
    expect(normalizeKeyModeType("harmonic-minor")).toBeNull();
  });
});

describe("getDiatonicHarmonyMidi", () => {
  // C major scale: [0, 2, 4, 5, 7, 9, 11]
  const cMajorIntervals = [0, 2, 4, 5, 7, 9, 11];
  const cRootSemitone = NOTE_TO_SEMITONE["C"]; // 0

  it("harmonizes C (midi 60) up a diatonic 3rd to E (midi 64)", () => {
    const result = getDiatonicHarmonyMidi(60, 2, cRootSemitone, cMajorIntervals);
    expect(result).toBe(64); // E4
  });

  it("harmonizes G (midi 67) up a diatonic 3rd to B (midi 71)", () => {
    const result = getDiatonicHarmonyMidi(67, 2, cRootSemitone, cMajorIntervals);
    expect(result).toBe(71); // B4
  });

  it("returns input + steps when note is not in scale", () => {
    // F# is not in C major, should fall back to chromatic
    const result = getDiatonicHarmonyMidi(66, 2, cRootSemitone, cMajorIntervals);
    expect(result).toBe(68); // chromatic fallback
  });
});
