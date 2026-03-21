import { describe, expect, it, vi } from "vitest";
import { createAudioSession } from "../../src/app/audio-session.js";

describe("audio-session", () => {
  it("starts pulse audio before fanout and clears active pulses after timeout", () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      const session = createAudioSession<"circle", "outer">({ now: () => 100 });
      session.registerInstrument("circle", {
        playPulse: (midis, durationMs) => {
          calls.push(`play:${midis.join(",")}:${durationMs}`);
        },
        startHold: () => undefined,
        stopHold: () => undefined,
      });
      session.onNoteOn((event) => {
        calls.push(`on:${event.source}:${event.startedAt}`);
      });
      session.onNoteOff((event) => {
        calls.push(`off:${event.noteId}`);
      });

      const noteId = session.playPulse({ instrumentId: "circle", source: "outer", midis: [60], durationMs: 240 });
      expect(noteId).toBeTruthy();
      expect(calls[0]).toBe("play:60:240");
      expect(calls[1]).toBe("on:circle:outer:100");
      expect(session.getActiveNotes()).toHaveLength(1);

      vi.advanceTimersByTime(240);
      expect(calls[2]).toBe(`off:${noteId}`);
      expect(session.getActiveNotes()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps repeated pulses stacked and releases holds independently", () => {
    vi.useFakeTimers();
    try {
      let nowMs = 500;
      const stopHold = vi.fn();
      const session = createAudioSession<"circle", "outer" | "note-bar">({ now: () => nowMs });
      session.registerInstrument("circle", {
        playPulse: () => undefined,
        startHold: () => undefined,
        stopHold,
      });

      const firstPulse = session.playPulse({ instrumentId: "circle", source: "outer", midis: [48, 52, 55], durationMs: 300 });
      nowMs += 90;
      vi.advanceTimersByTime(90);
      const secondPulse = session.playPulse({ instrumentId: "circle", source: "outer", midis: [48, 52, 55], durationMs: 300 });
      const holdId = session.startHold({ instrumentId: "circle", source: "note-bar", midis: [60] });

      expect(session.getActiveNotes().map((event) => event.noteId)).toEqual([firstPulse, secondPulse, holdId]);

      nowMs += 210;
      vi.advanceTimersByTime(210);
      expect(session.getActiveNotes().map((event) => event.noteId)).toEqual([secondPulse, holdId]);

      session.stopHold(holdId!);
      expect(stopHold).toHaveBeenCalledTimes(1);
      expect(session.getActiveNotes().map((event) => event.noteId)).toEqual([secondPulse]);
    } finally {
      vi.useRealTimers();
    }
  });
});
