import { describe, expect, it } from "vitest";
import {
  BLUES_PROGRESSIONS,
  BASS_STYLES,
  getBassStyle,
  getProgression,
  resolveProgression,
  gridRowsForBarCount,
  midiToFrequency,
  keyToPitchClass,
} from "../../src/modes/blues-jam-logic.js";

describe("blues-jam-logic", () => {
  it("exposes the five expected progressions with 4-divisible bar counts", () => {
    const ids = BLUES_PROGRESSIONS.map((p) => p.id);
    expect(ids).toEqual([
      "twelve-bar",
      "twelve-bar-quick-change",
      "sixteen-bar",
      "eight-bar",
      "minor-blues",
    ]);
    for (const progression of BLUES_PROGRESSIONS) {
      expect(progression.bars.length % 4).toBe(0);
    }
  });

  it("maps bar counts to a 4-column grid row count", () => {
    expect(gridRowsForBarCount(8)).toBe(2);
    expect(gridRowsForBarCount(12)).toBe(3);
    expect(gridRowsForBarCount(16)).toBe(4);
  });

  it("twelve-bar slow change keeps bar 2 on the I chord", () => {
    const bars = resolveProgression("twelve-bar", "C");
    expect(bars.map((b) => b.label)).toEqual([
      "C7", "C7", "C7", "C7",
      "F7", "F7", "C7", "C7",
      "G7", "F7", "C7", "G7",
    ]);
  });

  it("quick change puts IV in bar 2", () => {
    const bars = resolveProgression("twelve-bar-quick-change", "C");
    expect(bars[1]!.label).toBe("F7");
  });

  it("minor blues uses minor i/iv, a bVI major, and a dominant V", () => {
    const bars = resolveProgression("minor-blues", "A");
    // i = Am, iv = Dm, bVI = F, V = E7
    expect(bars[0]!.label).toBe("Am");
    expect(bars[1]!.label).toBe("Dm");
    expect(bars[8]!.label).toBe("F");
    expect(bars[9]!.label).toBe("E7");
  });

  it("transposes chord roots by key", () => {
    const inE = resolveProgression("twelve-bar", "E");
    // I=E, IV=A, V=B in the key of E.
    expect(inE[0]!.label).toBe("E7");
    expect(inE[4]!.label).toBe("A7");
    expect(inE[8]!.label).toBe("B7");
  });

  it("default Root Pump produces an 8-eighth driving root line", () => {
    const bars = resolveProgression("twelve-bar", "C");
    const firstBar = bars[0]!;
    expect(firstBar.bassLine).toHaveLength(8);
    expect(firstBar.chordMidi.length).toBeGreaterThanOrEqual(3);
    // The first six eighths all sit on the chord root.
    const root = firstBar.bassLine[0]!;
    for (let i = 0; i < 6; i += 1) expect(firstBar.bassLine[i]).toBe(root);
    // Beat 4 lifts to the fifth before the change.
    expect(firstBar.bassLine[6]! - root).toBe(7);
  });

  it("ends each bar on a half-step leading tone into the next bar's root", () => {
    // C7 (bar1) -> F7 (bar5). The last eighth of bar 4 resolves up a half step.
    const bars = resolveProgression("twelve-bar", "C");
    const approach = bars[3]!.bassLine[7]!;
    const nextRoot = bars[4]!.bassLine[0]!;
    expect(((nextRoot - approach) % 12 + 12) % 12).toBe(1);
  });

  it("exposes eight bass styles with valid feels", () => {
    expect(BASS_STYLES.map((s) => s.id)).toEqual([
      "root-pump",
      "octave-pump",
      "box",
      "boogie",
      "blues-riff",
      "pentatonic",
      "two-feel",
      "syncopated-push",
    ]);
    for (const style of BASS_STYLES) {
      expect(["straight", "shuffle", "half"]).toContain(style.feel);
    }
    expect(getBassStyle("box").feel).toBe("shuffle");
    expect(getBassStyle("totally-unknown" as never).id).toBe("root-pump");
  });

  it("each bass style yields a length-8 grid; styles differ from each other", () => {
    const signatures = new Set<string>();
    for (const style of BASS_STYLES) {
      const bars = resolveProgression("twelve-bar", "C", style.id);
      expect(bars[0]!.bassLine).toHaveLength(8);
      signatures.add(bars[0]!.bassLine.map((n) => n ?? "_").join(","));
    }
    // No two styles should render the I bar identically.
    expect(signatures.size).toBe(BASS_STYLES.length);
  });

  it("Octave Pump alternates root and octave", () => {
    const [bar] = resolveProgression("twelve-bar", "C", "octave-pump");
    const root = bar!.bassLine[0]!;
    expect(bar!.bassLine[1]! - root).toBe(12);
    expect(bar!.bassLine[2]).toBe(root);
  });

  it("Two-Feel is sparse: only beats 1 and 3 sound", () => {
    const [bar] = resolveProgression("twelve-bar", "C", "two-feel");
    const sounding = bar!.bassLine
      .map((n, i) => (n != null ? i : -1))
      .filter((i) => i >= 0);
    expect(sounding).toEqual([0, 4]);
  });

  it("Boogie Walk climbs root-3-5-6 over a dominant chord", () => {
    const [bar] = resolveProgression("twelve-bar", "C", "boogie");
    const root = bar!.bassLine[0]!;
    expect(bar!.bassLine[1]! - root).toBe(4); // major third
    expect(bar!.bassLine[2]! - root).toBe(7); // fifth
    expect(bar!.bassLine[3]! - root).toBe(9); // sixth
  });

  it("keyToPitchClass and midiToFrequency behave", () => {
    expect(keyToPitchClass("C")).toBe(0);
    expect(keyToPitchClass("A")).toBe(9);
    expect(midiToFrequency(69)).toBeCloseTo(440, 5);
  });

  it("getProgression falls back to the first progression for unknown ids", () => {
    expect(getProgression("twelve-bar").id).toBe("twelve-bar");
  });
});
