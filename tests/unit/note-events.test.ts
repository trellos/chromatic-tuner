import { describe, expect, it, vi } from "vitest";
import { createNoteEventHub } from "../../src/app/note-events.js";

describe("note-events", () => {
  it("emits note-on/off in order for a pulse and clears active notes after timeout", () => {
    vi.useFakeTimers();
    try {
      let nowMs = 1200;
      const noteOn: string[] = [];
      const noteOff: string[] = [];
      const hub = createNoteEventHub<"circle">({
        now: () => nowMs,
        setTimeoutFn: (handler, delayMs) => setTimeout(handler, delayMs),
        clearTimeoutFn: (id) => clearTimeout(id),
      });
      hub.onNoteOn((event) => noteOn.push(`${event.source}:${event.midis.join(",")}:${event.startedAt}`));
      hub.onNoteOff((event) => noteOff.push(event.noteId));

      const noteId = hub.emitPulse({ source: "circle", midis: [60], durationMs: 240, origin: "live" });
      expect(noteId).not.toBeNull();
      expect(noteOn).toEqual(["circle:60:1200"]);
      expect(hub.getActiveNotes()).toHaveLength(1);

      nowMs += 240;
      vi.advanceTimersByTime(240);
      expect(noteOff).toEqual([noteId]);
      expect(hub.getActiveNotes()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps repeated pulses of the same chord stacked as separate active notes", () => {
    vi.useFakeTimers();
    try {
      let nowMs = 500;
      const hub = createNoteEventHub<"circle">({
        now: () => nowMs,
        setTimeoutFn: (handler, delayMs) => setTimeout(handler, delayMs),
        clearTimeoutFn: (id) => clearTimeout(id),
      });

      const firstId = hub.emitPulse({ source: "circle", midis: [48, 52, 55], durationMs: 300 });
      nowMs += 90;
      vi.advanceTimersByTime(90);
      const secondId = hub.emitPulse({ source: "circle", midis: [48, 52, 55], durationMs: 300 });
      const activeIds = hub.getActiveNotes().map((event) => event.noteId);
      expect(activeIds).toEqual([firstId, secondId]);

      nowMs += 210;
      vi.advanceTimersByTime(210);
      expect(hub.getActiveNotes().map((event) => event.noteId)).toEqual([secondId]);

      nowMs += 90;
      vi.advanceTimersByTime(90);
      expect(hub.getActiveNotes()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tracks held notes independently from stacked pulses", () => {
    vi.useFakeTimers();
    try {
      let nowMs = 1000;
      const noteOff: Array<{ noteId: string; durationMs: number }> = [];
      const hub = createNoteEventHub<"circle">({
        now: () => nowMs,
        setTimeoutFn: (handler, delayMs) => setTimeout(handler, delayMs),
        clearTimeoutFn: (id) => clearTimeout(id),
      });
      hub.onNoteOff((event) => noteOff.push({ noteId: event.noteId, durationMs: event.durationMs }));

      const holdId = hub.startHold({ source: "circle", midis: [60], origin: "live" });
      nowMs += 40;
      vi.advanceTimersByTime(40);
      const pulseId = hub.emitPulse({ source: "circle", midis: [60], durationMs: 120, origin: "playback" });

      expect(hub.getActiveNotes().map((event) => event.noteId)).toEqual([holdId, pulseId]);

      nowMs += 120;
      vi.advanceTimersByTime(120);
      expect(hub.getActiveNotes().map((event) => event.noteId)).toEqual([holdId]);

      nowMs += 80;
      hub.stopHold(holdId!, nowMs);
      expect(noteOff).toEqual([
        { noteId: pulseId!, durationMs: 120 },
        { noteId: holdId!, durationMs: 240 },
      ]);
      expect(hub.getActiveNotes()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
