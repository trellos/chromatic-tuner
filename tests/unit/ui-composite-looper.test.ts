// @vitest-environment jsdom
/**
 * Unit tests for ui-composite-looper.ts state machine.
 *
 * The looper is purely logic-driven; tests exercise measure recording,
 * playback scheduling, and the overwrite-by-index semantics.
 *
 * Key timing contract:
 *   onBeatBoundary(beatIndex=0) fires the measure-boundary handler which:
 *     1. Advances playbackMeasureIndex.
 *     2. Finalises the previous recording measure (if recording).
 *     3. Starts the next recording measure (if armed/recording).
 *     4. Schedules playback for the new playbackMeasureIndex.
 *
 * So a boundary at time T starts playing the notes scheduled in the NEW
 * measure. Playback of measure N fires on the boundary where the index
 * transitions to N (not the boundary where N started recording).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createUiCompositeLooper,
  type CompositeLooperBeatBoundaryEvent,
} from "../../src/ui/ui-composite-looper.js";

function makeBeat(beatIndex: number, scheduledPerfMs = 0): CompositeLooperBeatBoundaryEvent {
  return { beatIndex, beatsPerBar: 4, scheduledPerfMs };
}

type PlaybackEvent = { measureIndex: number; midis: number[]; durationMs: number };

function makeLooper(onPlaybackEvent?: (e: PlaybackEvent) => void) {
  return createUiCompositeLooper({
    getMeasureDurationMs: () => 2000,
    onPlaybackEvent: onPlaybackEvent ?? (() => undefined),
  });
}

// ── Hold-record: single chord, no extra event on release ────────────────────

describe("CompositeLooper — hold-record produces exactly one note event", () => {
  it("recordHoldStart then recordHoldEnd writes one event with correct midis", () => {
    const looper = makeLooper();
    looper.onTransportStart();
    looper.requestArm();

    // Boundary 0 → armed → recording measure 0.
    looper.onBeatBoundary(makeBeat(0, 0));
    expect(looper.getRecordState()).toBe("recording");

    // Hold chord from ~t=100ms to ~t=300ms (within the 2000ms measure).
    looper.recordHoldStart("chord-test", [60, 64, 67]);
    looper.recordHoldEnd("chord-test");

    // Boundary 1 → finalises measure 0 (slot 0 written).
    looper.requestStop();
    looper.onBeatBoundary(makeBeat(0, 2000));
    // Boundary 2 → stop finalised.
    looper.onBeatBoundary(makeBeat(0, 4000));

    const slots = looper.getMeasureSlots();
    // Exactly one slot, one event, no duplicate from release.
    expect(slots[0]?.events).toHaveLength(1);
    expect(slots[0]?.events[0]?.midis).toEqual([60, 64, 67]);

    looper.destroy();
  });
});

// ── Records to correct measure ───────────────────────────────────────────────

describe("CompositeLooper — records to correct measure slot", () => {
  it("note in measure 0 lands in slot 0, not slot 1", () => {
    const looper = makeLooper();
    looper.onTransportStart();
    looper.requestArm();

    looper.onBeatBoundary(makeBeat(0, 0));   // armed → recording m0
    looper.recordPulse([60], 100);
    looper.requestStop();
    looper.onBeatBoundary(makeBeat(0, 2000)); // finalise m0 → stop
    looper.onBeatBoundary(makeBeat(0, 4000)); // idle

    const slots = looper.getMeasureSlots();
    expect(slots[0]?.events[0]?.midis).toEqual([60]);
    // Should not exist at slot 1.
    expect(slots[1]).toBeUndefined();

    looper.destroy();
  });

  it("note in measure 1 lands in slot 1, slot 0 is empty", () => {
    const looper = makeLooper();
    looper.onTransportStart();
    looper.requestArm();

    looper.onBeatBoundary(makeBeat(0, 0));    // armed → recording m0 (no notes)
    looper.onBeatBoundary(makeBeat(0, 2000)); // finalise m0 (empty) → recording m1
    looper.recordPulse([62], 100);
    looper.requestStop();
    looper.onBeatBoundary(makeBeat(0, 4000)); // finalise m1 → stop
    looper.onBeatBoundary(makeBeat(0, 6000)); // idle

    const slots = looper.getMeasureSlots();
    expect(slots[0]?.events).toHaveLength(0);
    expect(slots[1]?.events[0]?.midis).toEqual([62]);

    looper.destroy();
  });

  it("a note recorded in measure 0 fires playback only when playback index is 0", () => {
    vi.useFakeTimers();
    const events: PlaybackEvent[] = [];
    const looper = makeLooper((e) => events.push(e));
    looper.onTransportStart();
    looper.requestArm();

    // Record one measure with a note.
    looper.onBeatBoundary(makeBeat(0, 0));
    looper.recordPulse([60], 100);
    looper.requestStop();
    looper.onBeatBoundary(makeBeat(0, 2000)); // finalise m0 → stop

    // After finalising the 1-slot loop, playback wraps: index = (0+1)%1 = 0.
    // Boundary at 2000 schedules slot 0 playback — let that settle.
    vi.runAllTimers();
    events.length = 0;

    // Advance one more measure boundary → still index 0 (loop length 1).
    looper.onBeatBoundary(makeBeat(0, 4000));
    vi.runAllTimers();
    // Exactly one playback event, always for measure 0.
    expect(events).toHaveLength(1);
    expect(events[0]?.measureIndex).toBe(0);
    expect(events.every((e) => e.measureIndex === 0)).toBe(true);

    looper.destroy();
    vi.useRealTimers();
  });

  it("empty slot 0 does not generate playback events", () => {
    vi.useFakeTimers();
    const events: PlaybackEvent[] = [];
    const looper = makeLooper((e) => events.push(e));
    looper.onTransportStart();
    looper.requestArm();

    // Record 2 measures: m0 empty, m1 has a note.
    looper.onBeatBoundary(makeBeat(0, 0));    // m0 recording (no notes)
    looper.onBeatBoundary(makeBeat(0, 2000)); // finalise m0 → m1 recording
    looper.recordPulse([62], 100);
    looper.requestStop();
    looper.onBeatBoundary(makeBeat(0, 4000)); // finalise m1 → stop
    looper.onBeatBoundary(makeBeat(0, 6000)); // advance to m1 playback

    vi.runAllTimers();
    events.length = 0;

    // Boundary at 8000: playbackIndex = (1+1)%2 = 0 (empty) → no events.
    looper.onBeatBoundary(makeBeat(0, 8000));
    vi.runAllTimers();
    expect(events).toHaveLength(0);

    // Boundary at 10000: playbackIndex = (0+1)%2 = 1 (note) → 1 event.
    looper.onBeatBoundary(makeBeat(0, 10000));
    vi.runAllTimers();
    expect(events).toHaveLength(1);
    expect(events[0]?.measureIndex).toBe(1);

    looper.destroy();
    vi.useRealTimers();
  });
});

// ── Overwrite specific measure after seek ────────────────────────────────────

describe("CompositeLooper — overwrite specific measure after seek", () => {
  it("seeking to measure 0 and re-recording overwrites only slot 0, other slots unchanged", () => {
    vi.useFakeTimers();
    const events: PlaybackEvent[] = [];
    const looper = makeLooper((e) => events.push(e));
    looper.onTransportStart();

    // ── Phase 1: record 3 measures ──────────────────────────────────────────
    looper.requestArm();
    looper.onBeatBoundary(makeBeat(0, 0));    // m0 recording
    looper.recordPulse([60], 100);
    looper.onBeatBoundary(makeBeat(0, 2000)); // finalise m0, record m1
    looper.recordPulse([62], 100);
    looper.onBeatBoundary(makeBeat(0, 4000)); // finalise m1, record m2
    looper.recordPulse([64], 100);
    looper.requestStop();
    looper.onBeatBoundary(makeBeat(0, 6000)); // finalise m2 → stop
    looper.onBeatBoundary(makeBeat(0, 8000)); // idle

    const before = looper.getMeasureSlots();
    expect(before).toHaveLength(3);
    expect(before[0]?.events[0]?.midis).toEqual([60]);
    expect(before[1]?.events[0]?.midis).toEqual([62]);
    expect(before[2]?.events[0]?.midis).toEqual([64]);

    // ── Phase 2: seek to m0 and overwrite ──────────────────────────────────
    looper.seekToMeasure(0);
    looper.requestArm();
    // Next boundary: pendingSeekMeasure=0 resolves, write starts at slot 0.
    looper.onBeatBoundary(makeBeat(0, 10000));  // m0 overwrite recording
    looper.recordPulse([69], 100);              // new A4 note
    looper.requestStop();
    looper.onBeatBoundary(makeBeat(0, 12000));  // finalise m0 overwrite → stop
    looper.onBeatBoundary(makeBeat(0, 14000));  // idle

    const after = looper.getMeasureSlots();
    expect(after).toHaveLength(3);
    // Slot 0 replaced.
    expect(after[0]?.events).toHaveLength(1);
    expect(after[0]?.events[0]?.midis).toEqual([69]);
    // Slots 1 and 2 unchanged.
    expect(after[1]?.events[0]?.midis).toEqual([62]);
    expect(after[2]?.events[0]?.midis).toEqual([64]);

    // ── Phase 3: playback — run 3 boundaries to cover all 3 slots ──────────
    vi.runAllTimers();
    events.length = 0;
    // Advance through a full 3-measure cycle.
    looper.onBeatBoundary(makeBeat(0, 16000)); // some measure
    looper.onBeatBoundary(makeBeat(0, 18000)); // next measure
    looper.onBeatBoundary(makeBeat(0, 20000)); // next measure (full cycle seen)
    vi.runAllTimers();
    // Old note (60) must never appear — slot 0 was overwritten with 69.
    expect(events.some((e) => e.midis.includes(60))).toBe(false);
    // New note (69) must appear at some point in the cycle.
    expect(events.some((e) => e.midis.includes(69))).toBe(true);

    looper.destroy();
    vi.useRealTimers();
  });

  it("clearing then re-recording measure 0 produces only a 1-slot loop on measure 0", () => {
    vi.useFakeTimers();
    const events: PlaybackEvent[] = [];
    const looper = makeLooper((e) => events.push(e));
    looper.onTransportStart();

    // ── Phase 1: record 3 measures ──────────────────────────────────────────
    looper.requestArm();
    looper.onBeatBoundary(makeBeat(0, 0));
    looper.onBeatBoundary(makeBeat(0, 2000));
    looper.recordPulse([62], 100);
    looper.onBeatBoundary(makeBeat(0, 4000));
    looper.recordPulse([64], 100);
    looper.requestStop();
    looper.onBeatBoundary(makeBeat(0, 6000));
    looper.onBeatBoundary(makeBeat(0, 8000)); // idle

    expect(looper.getMeasureSlots()).toHaveLength(3);

    // ── Phase 2: clear ──────────────────────────────────────────────────────
    looper.rootEl.querySelector<HTMLButtonElement>(".ui-composite-looper-btn--clear")?.click();
    expect(looper.getMeasureSlots()).toHaveLength(0);

    // ── Phase 3: record only on measure 0 ──────────────────────────────────
    looper.seekToMeasure(0);
    looper.requestArm();
    looper.onBeatBoundary(makeBeat(0, 10000));
    looper.recordPulse([60], 100);
    looper.requestStop();
    looper.onBeatBoundary(makeBeat(0, 12000)); // finalise m0 → stop
    looper.onBeatBoundary(makeBeat(0, 14000)); // idle

    const slots = looper.getMeasureSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0]?.events[0]?.midis).toEqual([60]);

    // ── Phase 4: playback fires only on measure 0, never on others ─────────
    vi.runAllTimers();
    events.length = 0;
    // The 1-slot loop repeats on every boundary.
    looper.onBeatBoundary(makeBeat(0, 16000));
    vi.runAllTimers();
    looper.onBeatBoundary(makeBeat(0, 18000));
    vi.runAllTimers();
    // All events reference measure 0.
    expect(events.every((e) => e.measureIndex === 0)).toBe(true);
    // Events with old notes from measures 1 or 2 should never appear.
    expect(events.some((e) => e.midis.includes(62) || e.midis.includes(64))).toBe(false);

    looper.destroy();
    vi.useRealTimers();
  });
});

// ── Full 4-measure recording regression tests ────────────────────────────────

describe("CompositeLooper — 4-measure recording regression", () => {
  it("records 4 measures and plays them back in order (0, 1, 2, 3, 0, ...)", () => {
    vi.useFakeTimers();
    const events: PlaybackEvent[] = [];
    const looper = makeLooper((e) => events.push(e));
    looper.onTransportStart();
    looper.requestArm();

    // 4-measure recording (auto-stop after MAX_MEASURES=4).
    looper.onBeatBoundary(makeBeat(0, 0));    // armed → recording m0
    looper.recordPulse([60], 100);            // note in m0
    looper.onBeatBoundary(makeBeat(0, 2000)); // finalize m0 → recording m1
    looper.recordPulse([62], 100);            // note in m1
    looper.onBeatBoundary(makeBeat(0, 4000)); // finalize m1 → recording m2
    looper.recordPulse([64], 100);            // note in m2
    looper.onBeatBoundary(makeBeat(0, 6000)); // finalize m2 → recording m3
    looper.recordPulse([65], 100);            // note in m3
    // B4: auto-stop (recordedMeasuresInPass=4 >= MAX_MEASURES).
    looper.onBeatBoundary(makeBeat(0, 8000)); // finalize m3 → stop → schedule m0 playback

    // Verify all 4 slots were recorded correctly (synchronous check, no timers needed).
    const slots = looper.getMeasureSlots();
    expect(slots).toHaveLength(4);
    expect(slots[0]?.events[0]?.midis).toEqual([60]);
    expect(slots[1]?.events[0]?.midis).toEqual([62]);
    expect(slots[2]?.events[0]?.midis).toEqual([64]);
    expect(slots[3]?.events[0]?.midis).toEqual([65]);

    // Stop boundary schedules m0 for playback. Run timers to fire it.
    vi.runAllTimers();
    expect(events.some((e) => e.measureIndex === 0 && e.midis.includes(60))).toBe(true);

    // Cycle through one full loop: all 4 measures must appear.
    events.length = 0;
    looper.onBeatBoundary(makeBeat(0, 10000));
    looper.onBeatBoundary(makeBeat(0, 12000));
    looper.onBeatBoundary(makeBeat(0, 14000));
    looper.onBeatBoundary(makeBeat(0, 16000));
    vi.runAllTimers();

    const measuresPlayed = events.map((e) => e.measureIndex);
    expect(measuresPlayed).toContain(0);
    expect(measuresPlayed).toContain(1);
    expect(measuresPlayed).toContain(2);
    expect(measuresPlayed).toContain(3);

    looper.destroy();
    vi.useRealTimers();
  });

  it("onTransportStart() after requestArm() (count-in path) does not break measure-0 recording", () => {
    vi.useFakeTimers();
    const looper = makeLooper();

    // Count-in path: requestArm() fires before onTransportStart().
    looper.requestArm();
    looper.onTransportStart(); // fires async-after in production

    looper.onBeatBoundary(makeBeat(0, 0));   // recording m0 starts
    looper.recordPulse([60], 100);
    looper.requestStop();
    looper.onBeatBoundary(makeBeat(0, 2000)); // finalize m0 → stop

    const slots = looper.getMeasureSlots();
    expect(slots[0]?.events).toHaveLength(1);
    expect(slots[0]?.events[0]?.midis).toEqual([60]);

    looper.destroy();
    vi.useRealTimers();
  });

  it("notes played while armed (pre-arm buffer) land in slot 0 at step 0", () => {
    const looper = makeLooper();
    looper.onTransportStart();
    looper.requestArm();

    // Play note before first boundary (pre-arm buffer path).
    looper.recordPulse([60], 100);
    expect(looper.getRecordState()).toBe("armed");

    // First boundary flushes pre-arm buffer into m0.
    looper.onBeatBoundary(makeBeat(0, 0));
    expect(looper.getRecordState()).toBe("recording");

    looper.requestStop();
    looper.onBeatBoundary(makeBeat(0, 2000)); // finalize m0

    const slots = looper.getMeasureSlots();
    expect(slots[0]?.events).toHaveLength(1);
    expect(slots[0]?.events[0]?.midis).toEqual([60]);
    expect(slots[0]?.events[0]?.startStep).toBe(0);

    looper.destroy();
  });

  it("measure 0 note is not silently dropped when onTransportStart fires mid-measure", () => {
    const looper = makeLooper();
    looper.onTransportStart();
    looper.requestArm();
    looper.onBeatBoundary(makeBeat(0, 0)); // recording m0 starts

    // Simulate onTransportStart firing again (count-in async race).
    looper.onTransportStart();

    looper.recordPulse([60], 100);
    looper.requestStop();
    looper.onBeatBoundary(makeBeat(0, 2000)); // finalize m0

    const slots = looper.getMeasureSlots();
    // Slot 0 must have the note — it must not be dropped.
    expect(slots[0]?.events.length).toBeGreaterThan(0);
    expect(slots[0]?.events[0]?.midis).toEqual([60]);

    looper.destroy();
  });
});
