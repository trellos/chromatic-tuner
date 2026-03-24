import { createCircleGuitarPlayer } from "../audio/circle-guitar-player.js";
import { createAudioDispatch } from "../audio/audio-dispatch.js";
import { createFretboardPlayer, type FretboardPlayer } from "../audio/fretboard-player.js";
import { createDrumMachineUi, type DrumMachineUi } from "../ui/drum-machine.js";
import { createJamFlowUi, type JamFlowUi, type DiatonicChord } from "../ui/jam-flow.js";
import {
  FRETBOARD_DEFAULT_STATE,
  type FretboardState,
} from "../fretboard-logic.js";
import { createUiCompositeLooper, type CompositeLooper } from "../ui/ui-composite-looper.js";
import type { ModeDefinition } from "./types.js";
import { seigaihaBridge } from "../app/seigaiha-bridge.js";
import { setCarouselHidden } from "../app/carousel-bridge.js";
import { createSessionTransport } from "../app/session-transport.js";
import {
  decodeWildTunaTrackParam,
  encodeWildTunaTrackPayloadV3,
  decodeDrumTrackPayload,
  type WildTunaTrackPayload,
} from "../app/share-payloads.js";
import {
  createNoteEventHub,
  type NoteEventSnapshot,
} from "../app/note-events.js";

// Fixed number of measures shown in the timeline and cycled during playback.
// Now starts at 4 but can be changed dynamically (4, 8, 12, or 16 measures).
let GLOBAL_MEASURE_COUNT = 4;

// ── Playing Track API ──────────────────────────────────────────────────────
// Wild Tuna exposes a single aggregated note stream across both loopers.
// The shared note-event hub preserves stacking semantics, so repeated pulses of
// the same chord remain distinct active notes instead of overwriting each other.

export type TrackNoteSource = "circle" | "fretboard";
export type TrackNoteEvent = Omit<NoteEventSnapshot<TrackNoteSource>, "noteId" | "endAt" | "origin">;
export type ActiveTrackNote = TrackNoteEvent & {
  noteId: string;
  endAt: number;
};

export type WildTunaTrackApi = {
  onNoteOn: (handler: (event: TrackNoteEvent) => void) => () => void;
  onNoteOff: (handler: (event: TrackNoteEvent) => void) => () => void;
  getActiveNotes: () => ActiveTrackNote[];
};

type TrackApiInternal = WildTunaTrackApi & {
  _emitPulse: (event: Omit<TrackNoteEvent, "startedAt"> & { startedAt?: number; origin?: "live" | "playback" }) => string | null;
  _startHold: (event: Omit<TrackNoteEvent, "durationMs" | "startedAt"> & { startedAt?: number; origin?: "live" | "playback" }) => string | null;
  _stopHold: (noteId: string, endAt?: number) => void;
  _reset: () => void;
};

function toTrackNoteEvent(event: NoteEventSnapshot<TrackNoteSource>): TrackNoteEvent {
  const { noteId: _noteId, endAt: _endAt, origin: _origin, ...rest } = event;
  return rest;
}

function buildTrackApi(): TrackApiInternal {
  const hub = createNoteEventHub<TrackNoteSource>();

  return {
    _emitPulse(event) {
      return hub.emitPulse({
        ...event,
        origin: event.origin ?? "playback",
      });
    },
    _startHold(event) {
      return hub.startHold({
        ...event,
        origin: event.origin ?? "live",
      });
    },
    _stopHold(noteId, endAt) {
      hub.stopHold(noteId, endAt);
    },
    _reset() {
      hub.reset();
    },
    onNoteOn(handler) {
      return hub.onNoteOn((event) => handler(toTrackNoteEvent(event)));
    },
    onNoteOff(handler) {
      return hub.onNoteOff((event) => handler(toTrackNoteEvent(event)));
    },
    getActiveNotes() {
      return hub.getActiveNotes().map((event) => {
        const { origin: _origin, ...rest } = event;
        return rest;
      });
    },
  };
}

// Module-level singleton — recreated on each onEnter, cleared on onExit.
let _trackApi: TrackApiInternal = buildTrackApi();

/**
 * Returns the current Wild Tuna track API.
 * Subscribe to note-on/off events or poll getActiveNotes() for real-time playback state.
 * The same object is reused across mode entries; handlers are preserved between entries.
 */
export function getWildTunaTrackApi(): WildTunaTrackApi {
  return _trackApi;
}

function serializeWildTunaShareUrl(
  drumUi: DrumMachineUi,
  circleLooper: CompositeLooper,
  fretboardLooper: CompositeLooper,
  fretState: FretboardState
): string {
  const payload: WildTunaTrackPayload = {
    v: 1,
    drum: drumUi.getTrackPayload(),
    fret: { ...fretState },
    loops: [
      { id: "circle", measures: circleLooper.getMeasureSlots() },
      { id: "fretboard", measures: fretboardLooper.getMeasureSlots() },
    ],
  };
  const drumDecoded = decodeDrumTrackPayload(payload.drum);
  const encoded = drumDecoded.ok
    ? encodeWildTunaTrackPayloadV3(payload, drumDecoded.value)
    : encodeWildTunaTrackPayloadV3(payload, { version: 1, bpm: 120, kit: "rock", steps: "0".repeat(64) });
  const url = new URL(window.location.href);
  url.searchParams.set("mode", "wild-tuna");
  url.searchParams.set("track", encoded);
  return url.toString();
}

// Coordinator: enforces mutual-exclusion recording across loopers and
// handles the count-in flow when transport is stopped.
//
// Flow for REC press:
//   1. onRecPressed(source) stops all other active loopers.
//   2. If transport is already playing: arm source immediately.
//   3. If transport is stopped: trigger a 4-beat woodblock count-in on the
//      drum machine, then arm source and start transport together.
type LiveRecordingState = {
  looper: CompositeLooper;
  measureIndex: number;
  events: Array<{ midis: number[]; startStep: number; endStep: number }>;
} | null;

function createLooperCoordinator(getLoopers: () => CompositeLooper[], getDrumUi: () => ReturnType<typeof createDrumMachineUi> | null, getTimelineSteps: () => number, getMeasureCount: () => number) {
  let liveRecording: LiveRecordingState = null;

  return {
    onRecPressed(source: CompositeLooper) {
      const drumUi = getDrumUi();
      if (drumUi && !drumUi.isPlaying()) {
        // Transport is stopped: play 4-beat count-in then arm + start transport.
        drumUi.countIn(() => source.requestArm());
      } else {
        // Transport already running: arm immediately on next measure boundary.
        source.requestArm();
      }
    },
    // Called by each looper's onRecordingProgress callback.
    setLiveRecording(looper: CompositeLooper, measureIndex: number, events: Array<{ midis: number[]; startStep: number; endStep: number }>) {
      if (measureIndex < 0) {
        liveRecording = null;
      } else {
        liveRecording = { looper, measureIndex, events };
      }
    },
    // Seek all loopers to a specific measure index (used by timeline click).
    seekAll(measureIndex: number) {
      for (const looper of getLoopers()) looper.seekToMeasure(measureIndex);
    },
    getMaxMeasureCount() {
      return getMeasureCount();
    },
    // Returns how many loopers have recorded content in each measure slot.
    // Values are 0 (empty), 1, or 2 — used for timeline fill coloring.
    // The measure currently being recorded shows 0 (in-progress, not yet committed).
    getFillCounts(): number[] {
      const measureCount = getMeasureCount();
      const counts = Array<number>(measureCount).fill(0);
      for (const looper of getLoopers()) {
        const slots = looper.getMeasureSlots();
        for (let i = 0; i < Math.min(slots.length, measureCount); i++) {
          // If this looper is actively recording this measure, treat it as empty
          // (the old data is being overwritten; new data isn't committed yet).
          if (liveRecording?.looper === looper && liveRecording.measureIndex === i) continue;
          if ((slots[i]?.events.length ?? 0) > 0) counts[i] = (counts[i] ?? 0) + 1;
        }
      }
      return counts;
    },
    // Returns a 2D array [measureIndex][stepIndex] with the total note count
    // across all loopers for that step. A note spans startStep..endStep, so
    // it contributes to every step in that range.
    // The measure currently being recorded shows live in-progress events.
    getStepDensities(): number[][] {
      const steps = getTimelineSteps();
      const measureCount = getMeasureCount();
      const densities: number[][] = Array.from({ length: measureCount }, () =>
        Array<number>(steps).fill(0)
      );
      for (const looper of getLoopers()) {
        const slots = looper.getMeasureSlots();
        for (let mi = 0; mi < Math.min(slots.length, measureCount); mi++) {
          // Use live in-progress events for the actively-recording measure.
          const events =
            liveRecording?.looper === looper && liveRecording.measureIndex === mi
              ? liveRecording.events
              : (slots[mi]?.events ?? []);
          for (const event of events) {
            const noteCount = event.midis.length;
            for (let s = event.startStep; s < Math.min(event.endStep, steps); s++) {
              (densities[mi] as number[])[s] = ((densities[mi] as number[])[s] ?? 0) + noteCount;
            }
          }
        }
        // If live recording is beyond current slot count, add its events too.
        if (liveRecording?.looper === looper && liveRecording.measureIndex >= Math.min(slots.length, measureCount)) {
          const mi = liveRecording.measureIndex;
          if (mi < measureCount) {
            for (const event of liveRecording.events) {
              const noteCount = event.midis.length;
              for (let s = event.startStep; s < Math.min(event.endStep, steps); s++) {
                (densities[mi] as number[])[s] = ((densities[mi] as number[])[s] ?? 0) + noteCount;
              }
            }
          }
        }
      }
      return densities;
    },
  };
}

// Maps a total note count across all instruments at one step to an opacity.
// 0 notes → 0 (transparent), 1 → low, 2-3 → mid, 4+ → high.
function stepDensityToOpacity(noteCount: number): number {
  if (noteCount <= 0) return 0;
  if (noteCount === 1) return 0.25;
  if (noteCount <= 3) return 0.5;
  return 0.82;
}

// Builds the row of measure-indicator buttons between the drum machine and
// Circle/Fretboard panes. Each block is tappable to seek all loopers.
// Each block contains mini step-slot spans that light up based on note density.
// `update(currentMeasure, fillCounts, stepDensities)` refreshes all visuals.
// `rebuild(stepsPerBlock)` redraws with a new step count.
// When drum machine is visible, adds a pull handle to resize the timeline.
function buildWildTunaTimeline(host: HTMLElement, measureCount: number, isDrumVisible: boolean, onMeasureCountChange?: (newCount: number) => void) {
  let stepsPerBlock = 16;
  let currentMeasureCount = measureCount;
  const blocks: HTMLElement[] = [];
  const stepSpans: HTMLSpanElement[][] = [];
  const container = document.createElement("div");
  container.className = "wt-timeline-container";

  function buildBlocks() {
    const blocksContainer = container.querySelector(".wt-timeline-blocks") as HTMLElement;
    if (!blocksContainer) return;
    blocksContainer.replaceChildren();
    blocks.length = 0;
    stepSpans.length = 0;

    for (let i = 0; i < currentMeasureCount; i++) {
      const block = document.createElement("button");
      block.type = "button";
      block.className = "wt-timeline-block";
      block.dataset.measure = String(i);
      block.setAttribute("aria-label", `Measure ${i + 1}`);

      const spans: HTMLSpanElement[] = [];
      for (let s = 0; s < stepsPerBlock; s++) {
        const span = document.createElement("span");
        span.className = "wt-timeline-step";
        block.appendChild(span);
        spans.push(span);
      }
      stepSpans.push(spans);

      blocksContainer.appendChild(block);
      blocks.push(block);
    }
  }

  // Build DOM structure
  const blocksContainer = document.createElement("div");
  blocksContainer.className = "wt-timeline-blocks";
  container.appendChild(blocksContainer);

  // Add pull handle if drum is visible
  if (isDrumVisible) {
    const handleContainer = document.createElement("div");
    handleContainer.className = "wt-timeline-handle-container";
    const handle = document.createElement("div");
    handle.className = "wt-timeline-handle";
    handle.setAttribute("aria-label", "Resize timeline");
    handle.title = "Drag to resize timeline (4-16 measures)";
    handleContainer.appendChild(handle);
    container.appendChild(handleContainer);

    // Handle resizing
    let isDragging = false;
    let startY = 0;
    let startMeasureCount = currentMeasureCount;

    const onMouseDown = (e: MouseEvent | TouchEvent) => {
      isDragging = true;
      startY = (e instanceof MouseEvent ? e.clientY : e.touches[0]?.clientY) || 0;
      startMeasureCount = currentMeasureCount;
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("touchmove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.addEventListener("touchend", onMouseUp);
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging) return;
      const currentY = (e instanceof MouseEvent ? e.clientY : e.touches[0]?.clientY) || 0;
      const deltaY = currentY - startY;
      // Each ~40px of drag = one line (4 measures)
      const lineDelta = Math.round(deltaY / 40);
      const newCount = Math.max(4, Math.min(16, startMeasureCount + lineDelta * 4));

      if (newCount !== currentMeasureCount) {
        currentMeasureCount = newCount;
        buildBlocks();
      }
    };

    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("touchmove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchend", onMouseUp);

      // Notify that measure count changed
      if (currentMeasureCount !== startMeasureCount) {
        onMeasureCountChange?.(currentMeasureCount);
      }
    };

    handle.addEventListener("mousedown", onMouseDown);
    handle.addEventListener("touchstart", onMouseDown);
  }

  host.replaceChildren(container);
  buildBlocks();

  return {
    rebuild(n: number) {
      stepsPerBlock = n;
      buildBlocks();
    },
    update(currentMeasure: number, fillCounts: number[], stepDensities: number[][]) {
      blocks.forEach((block, i) => {
        block.classList.toggle("is-current", i === currentMeasure);
        block.dataset.fill = String(Math.min(fillCounts[i] ?? 0, 2));
        const spans = stepSpans[i] ?? [];
        const densities = stepDensities[i] ?? [];
        spans.forEach((span, s) => {
          const opacity = stepDensityToOpacity(densities[s] ?? 0);
          span.style.opacity = opacity > 0 ? String(opacity) : "";
          span.classList.toggle("has-notes", opacity > 0);
        });
      });
    },
    getMeasureCount() {
      return currentMeasureCount;
    },
  };
}

function noteCountToRandomness(count: number): number {
  // 0 notes → 0, 1 note → ~0.18, 3 notes → ~0.42, 6+ notes → ~0.78
  return Math.min(0.8, 1 - Math.pow(0.72, count));
}

function syncTrackRandomness(trackApi: WildTunaTrackApi): () => void {
  const update = () => {
    const activeNoteCount = trackApi.getActiveNotes().reduce((sum, event) => sum + event.midis.length, 0);
    seigaihaBridge.setModeRandomness(noteCountToRandomness(activeNoteCount));
  };

  const stopOn = trackApi.onNoteOn(update);
  const stopOff = trackApi.onNoteOff(update);
  update();
  return () => {
    stopOn();
    stopOff();
  };
}

// Wild Tuna mode: a three-pane jam workspace combining Drum Machine,
// Circle of Fifths, and Fretboard with synchronized MIDI loop recording.
//
// Architecture overview:
//   ┌─────────────────────────────────────────────────────────────────┐
//   │  DrumMachine  →  onTransportStart/Stop/BeatBoundary callbacks  │
//   │       ↓                                                        │
//   │  LooperCoordinator  →  exclusive REC + count-in logic         │
//   │       ↓                                                        │
//   │  CircleLooper + FretboardLooper (CompositeLooper instances)    │
//   │       ↓  (onPlaybackEvent)                                     │
//   │  playCircleMidis / FretboardPlayer  →  audio + visual pulse   │
//   └─────────────────────────────────────────────────────────────────┘
//
// Transport lifecycle:
//   - Drum machine starts/stops transport.
//   - Both loopers receive onTransportStart/Stop and onBeatBoundary.
//   - On each measure boundary (beatIndex === 0), looper state advances:
//       armed → recording → stopping → idle
//   - Session transport tracks the shared measure index so timeline updates
//     stay deterministic even when loopers have different internal loop lengths.
//
// Save/load:
//   - Share button serializes drum pattern + both loop slots to base64url JSON.
//   - URL param `?mode=wild-tuna&track=<payload>` hydrates on onEnter.
export function createWildTunaMode(): ModeDefinition {
  const modeEl = document.querySelector<HTMLElement>('.mode-screen[data-mode="wild-tuna"]');
  if (!modeEl) {
    return { id: "wild-tuna", title: "Wild Tuna", preserveState: false, canFullscreen: true };
  }

  const drumHost = modeEl.querySelector<HTMLElement>("[data-wild-tuna-drum]");
  const jamFlowHost = modeEl.querySelector<HTMLElement>("[data-wild-tuna-jamflow]");
  const circleLooperHost = modeEl.querySelector<HTMLElement>("[data-wild-tuna-circle-looper]");
  const fretboardLooperHost = modeEl.querySelector<HTMLElement>("[data-wild-tuna-fretboard-looper]");
  const timelineHost = modeEl.querySelector<HTMLElement>("[data-wild-tuna-timeline]");
  const fullscreenTrigger = modeEl.querySelector<HTMLButtonElement>("[data-wild-tuna-fullscreen]");
  const fullscreenClose = modeEl.querySelector<HTMLButtonElement>("[data-wild-tuna-close]");
  let modeAbort: AbortController | null = null;
  let timelineUi: ReturnType<typeof buildWildTunaTimeline> | null = null;
  let drumUi: ReturnType<typeof createDrumMachineUi> | null = null;
  let jamFlowUi: JamFlowUi | null = null;
  let circleLooper: CompositeLooper | null = null;
  let fretboardLooper: CompositeLooper | null = null;
  let fretboardState: FretboardState = { ...FRETBOARD_DEFAULT_STATE };
  const audioDispatch = createAudioDispatch();
  const guitarPlayer = createCircleGuitarPlayer({ getContext: audioDispatch.getContext });
  const fretboardPlayer: FretboardPlayer = createFretboardPlayer(audioDispatch);
  const liveTrackHoldIds = new Map<string, string>();
  let stopTrackRandomnessSync: (() => void) | null = null;

  let sessionTransport = createSessionTransport();

  const playCircleMidis = async (midis: number[], durationMs: number, shouldRecord: boolean): Promise<void> => {
    if (!midis.length) return;
    if (shouldRecord) circleLooper?.recordPulse(midis, durationMs);
    if (midis.length === 1) {
      const midi = midis[0];
      if (midi === undefined) return;
      jamFlowUi?.pulseNote(midi, durationMs);
      await guitarPlayer.playMidi(midi, durationMs);
      return;
    }
    jamFlowUi?.pulseChord(midis, durationMs);
    await guitarPlayer.playChord(midis, durationMs);
  };

  // Build major chord MIDI numbers (root + M3 + P5) from a semitone (0–11).
  function majorChordMidis(semitone: number): number[] {
    const root = 48 + semitone;
    return [root, root + 4, root + 7];
  }

  // Build minor chord MIDI numbers (root + m3 + P5) from a semitone (0–11).
  function minorChordMidis(semitone: number): number[] {
    const root = 48 + semitone;
    return [root, root + 3, root + 7];
  }

  // Build chord MIDI numbers from a DiatonicChord (respects major/minor/diminished quality).
  function diatonicChordMidis(chord: DiatonicChord): number[] {
    const root = 48 + chord.semitone;
    if (chord.quality === "minor") return [root, root + 3, root + 7];
    if (chord.quality === "diminished") return [root, root + 3, root + 6];
    return [root, root + 4, root + 7]; // major
  }

  const replaceLiveHold = (holdKey: string, source: TrackNoteSource, midis: number[]): void => {
    const previousId = liveTrackHoldIds.get(holdKey);
    if (previousId) {
      _trackApi._stopHold(previousId);
    }
    const noteId = _trackApi._startHold({ source, midis, origin: "live" });
    if (noteId) {
      liveTrackHoldIds.set(holdKey, noteId);
    } else {
      liveTrackHoldIds.delete(holdKey);
    }
  };

  const stopLiveHold = (holdKey: string): void => {
    const noteId = liveTrackHoldIds.get(holdKey);
    if (!noteId) return;
    liveTrackHoldIds.delete(holdKey);
    _trackApi._stopHold(noteId);
  };

  return {
    id: "wild-tuna",
    title: "Wild Tuna",
    preserveState: false,
    canFullscreen: true,
    onEnter: async () => {
      stopTrackRandomnessSync?.();
      _trackApi._reset();
      stopTrackRandomnessSync = syncTrackRandomness(_trackApi);
      sessionTransport = createSessionTransport();
      modeAbort?.abort();
      modeAbort = new AbortController();
      if (fullscreenTrigger) {
        fullscreenTrigger.addEventListener("click", () => setCarouselHidden(true), { signal: modeAbort.signal });
      }
      if (fullscreenClose) {
        fullscreenClose.addEventListener("click", () => setCarouselHidden(false), { signal: modeAbort.signal });
      }
      if (!drumHost || !jamFlowHost || !circleLooperHost) return;

      // Coordinator is created first so the loopers can reference it in
      // their onRecButtonPressed callbacks (circular reference via closures).
      const coordinator = createLooperCoordinator(
        () => {
          const loopers: CompositeLooper[] = [];
          if (circleLooper) loopers.push(circleLooper);
          if (fretboardLooper) loopers.push(fretboardLooper);
          return loopers;
        },
        () => drumUi,
        () => drumUi?.getStepsPerBar() ?? 16,
        () => GLOBAL_MEASURE_COUNT
      );

      const onRecordingProgress = (looper: () => CompositeLooper | null) => (
        measureIndex: number,
        events: Array<{ midis: number[]; startStep: number; endStep: number }>
      ) => {
        coordinator.setLiveRecording(looper()!, measureIndex, events);
        const currentMeasure = sessionTransport.getMeasureIndex() % Math.max(1, coordinator.getMaxMeasureCount());
        timelineUi?.update(currentMeasure, coordinator.getFillCounts(), coordinator.getStepDensities());
      };

      circleLooper = createUiCompositeLooper({
        getMeasureDurationMs: () => ((60 / Math.max(1, drumUi?.getBpm() ?? 120)) * 4 * 1000),
        getStepsPerMeasure: () => drumUi?.getStepsPerBar() ?? 16,
        onPlaybackEvent: (event) => {
          _trackApi._emitPulse({ source: "circle", ...event, startedAt: performance.now(), origin: "playback" });
          void playCircleMidis(event.midis, event.durationMs, false);
        },
        onRecButtonPressed: () => coordinator.onRecPressed(circleLooper!),
        onRecordingProgress: onRecordingProgress(() => circleLooper),
      });
      circleLooperHost.replaceChildren(circleLooper.rootEl);

      fretboardLooper = createUiCompositeLooper({
        getMeasureDurationMs: () => ((60 / Math.max(1, drumUi?.getBpm() ?? 120)) * 4 * 1000),
        getStepsPerMeasure: () => drumUi?.getStepsPerBar() ?? 16,
        onPlaybackEvent: (event) => {
          _trackApi._emitPulse({ source: "fretboard", ...event, startedAt: performance.now(), origin: "playback" });
          const targets = event.midis.map((midi) => ({ midi, stringIndex: 0 }));
          void fretboardPlayer.playTargets(targets, event.durationMs);
          jamFlowUi?.pulseTargets(targets, event.durationMs);
        },
        onRecButtonPressed: () => coordinator.onRecPressed(fretboardLooper!),
        onRecordingProgress: onRecordingProgress(() => fretboardLooper),
      });
      fretboardLooperHost?.replaceChildren(fretboardLooper.rootEl);

      // Drum machine generates its own DOM; wild-tuna just appends drumUi.rootEl.
      drumUi = createDrumMachineUi({
        getAudioContext: audioDispatch.getContext,
        onTransportStart: () => {
          sessionTransport.notifyStart();
        },
        onTransportStop: () => {
          sessionTransport.notifyStop();
        },
        onBeatBoundary: (event) => {
          sessionTransport.notifyBeatBoundary(event);
        },
        onShareOverride: () => {
          void (async () => {
            const url = serializeWildTunaShareUrl(drumUi!, circleLooper!, fretboardLooper!, fretboardState);
            const shareButtonEl = drumUi?.rootEl.querySelector<HTMLButtonElement>("[data-drum-share]");
            try {
              if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url);
                shareButtonEl?.setAttribute("aria-label", "Share URL copied");
              } else {
                window.prompt("Copy this Wild Tuna URL", url);
              }
            } catch {
              window.prompt("Copy this Wild Tuna URL", url);
            }
          })();
        },
        onStepsPerBarChange: (n) => {
          timelineUi?.rebuild(n);
          timelineUi?.update(
            sessionTransport.getMeasureIndex() % Math.max(1, coordinator.getMaxMeasureCount()),
            coordinator.getFillCounts(),
            coordinator.getStepDensities()
          );
        },
      });
      drumHost.replaceChildren(drumUi.rootEl);
      // Re-append the close button after replaceChildren wipes the drum host.
      if (fullscreenClose) drumHost.appendChild(fullscreenClose);

      // Transport coordinator owns event ordering and shared measure index for both loopers.
      sessionTransport.onStart(() => {
        circleLooper?.onTransportStart();
        fretboardLooper?.onTransportStart();
        timelineUi?.update(0, coordinator.getFillCounts(), coordinator.getStepDensities());
      });
      sessionTransport.onStop(() => {
        circleLooper?.onTransportStop();
        fretboardLooper?.onTransportStop();
      });
      sessionTransport.onBeatBoundary((event) => {
        circleLooper?.onBeatBoundary(event);
        fretboardLooper?.onBeatBoundary(event);
        if (event.beatIndex === 0) {
          const measureIndex = sessionTransport.getMeasureIndex() % Math.max(1, coordinator.getMaxMeasureCount());
          timelineUi?.update(measureIndex, coordinator.getFillCounts(), coordinator.getStepDensities());
        }
      });

      const initialInstrumentName = guitarPlayer.setInstrument("guitar-acoustic");

      const compositeEl = modeEl.querySelector<HTMLElement>("[data-wild-tuna-composite]");

      jamFlowUi = createJamFlowUi(jamFlowHost, {
        getMeasureDurationMs: () => (60 / Math.max(1, drumUi?.getBpm() ?? 120)) * 4 * 1000,
        onKeySelect: (_semitone) => {
          // Double-tap entered key zoom — sustain already started via onKeyPressStart.
          // No additional playback needed here.
        },
        onKeyPressStart: (semitone, isMinor) => {
          // Start sustain when the user presses down on a circle flower.
          const midis = isMinor ? minorChordMidis(semitone) : majorChordMidis(semitone);
          circleLooper?.recordHoldStart("circle-key", midis);
          replaceLiveHold("circle-key", "circle", midis);
          void guitarPlayer.startSustainChord(midis);
        },
        onKeyPressEnd: () => {
          circleLooper?.recordHoldEnd("circle-key");
          stopLiveHold("circle-key");
          guitarPlayer.stopSustain();
        },
        onInnerDoubleTap: () => {
          const name = guitarPlayer.cycleInstrument();
          jamFlowUi?.setInstrumentLabel(name);
        },
        onChordTap: (chord) => {
          // Pressed down on a key-zoom chord flower → start sustain.
          const midis = diatonicChordMidis(chord);
          circleLooper?.recordHoldStart("key-zoom-chord", midis);
          replaceLiveHold("key-zoom-chord", "circle", midis);
          void guitarPlayer.startSustainChord(midis);
        },
        onChordPressEnd: () => {
          circleLooper?.recordHoldEnd("key-zoom-chord");
          stopLiveHold("key-zoom-chord");
          guitarPlayer.stopSustain();
        },
        onNoteBarPressStart: (semitone) => {
          const midi = 48 + semitone;
          circleLooper?.recordHoldStart("note-bar", [midi]);
          replaceLiveHold("note-bar", "circle", [midi]);
          void guitarPlayer.startSustainMidi(midi);
        },
        onNoteBarPressEnd: (_semitone) => {
          circleLooper?.recordHoldEnd("note-bar");
          stopLiveHold("note-bar");
          guitarPlayer.stopSustain();
        },
        onFretDotTap: (midi, stringIndex) => {
          // Pressed down on a fretboard dot → start sustain.
          fretboardLooper?.recordHoldStart("fret-dot", [midi]);
          replaceLiveHold("fret-dot", "fretboard", [midi]);
          void fretboardPlayer.startSustain([{ midi, stringIndex }]);
        },
        onFretDotPressEnd: () => {
          fretboardLooper?.recordHoldEnd("fret-dot");
          stopLiveHold("fret-dot");
          fretboardPlayer.stopSustain();
        },
        isRecording: () => {
          const cs = circleLooper?.getRecordState();
          const fs = fretboardLooper?.getRecordState();
          return cs === "armed" || cs === "recording" || cs === "stopping"
              || fs === "armed" || fs === "recording" || fs === "stopping";
        },
        onTransitionStart: (from, to) => {
          if (from === "circle") {
            // Leaving circle: start drum fade-out immediately so it syncs with canvas animation.
            compositeEl?.classList.add("wt-drum-hidden");
          } else if (to === "circle") {
            // Returning to circle: expand drum height NOW (while drum is still invisible)
            // so the canvas gets correct dimensions before the first animation frame.
            compositeEl?.classList.remove("wt-jam-expanded");
          }
        },
        onModeChange: (mode) => {
          const inCircle = mode === "circle";
          // Height collapse: only applied once we've fully settled in key-zoom/fretboard,
          // after the drum opacity is already 0, so the resize isn't visible.
          if (!inCircle) compositeEl?.classList.add("wt-jam-expanded");
          // Fade drum back in when returning to circle (height was already restored in onTransitionStart).
          if (inCircle) compositeEl?.classList.remove("wt-drum-hidden");

          // Show only the looper relevant to the current instrument view
          const showCircle = mode !== "fretboard";
          if (circleLooperHost) circleLooperHost.style.display = showCircle ? "" : "none";
          if (fretboardLooperHost) fretboardLooperHost.style.display = showCircle ? "none" : "";
        },
      });
      // Set initial instrument label so it reflects the player state
      jamFlowUi.setInstrumentLabel(initialInstrumentName);
      jamFlowUi.enter();
      await drumUi.enter();

      if (timelineHost) {
        timelineUi = buildWildTunaTimeline(
          timelineHost,
          coordinator.getMaxMeasureCount(),
          !!drumUi,
          (newCount) => {
            // Update the global measure count
            GLOBAL_MEASURE_COUNT = newCount;
            // If transport is playing, adjust the loop to fit the new measure count
            if (drumUi?.isPlaying()) {
              // Get current measure index and wrap it
              const currentMeasure = sessionTransport.getMeasureIndex() % newCount;
              sessionTransport.setMeasureIndexBeforeNextBoundary(currentMeasure, newCount);
            }
            // Update coordinator so it uses new measure count
            coordinator.getMaxMeasureCount();
            // Refresh timeline visuals
            timelineUi?.update(sessionTransport.getMeasureIndex() % newCount, coordinator.getFillCounts(), coordinator.getStepDensities());
          }
        );
        timelineHost.addEventListener("click", (event) => {
          const block = (event.target as Element)?.closest<HTMLElement>("[data-measure]");
          const idx = block ? parseInt(block.dataset.measure ?? "", 10) : NaN;
          if (!isNaN(idx)) {
            sessionTransport.setMeasureIndexBeforeNextBoundary(idx, coordinator.getMaxMeasureCount());
            timelineUi?.update(idx, coordinator.getFillCounts(), coordinator.getStepDensities());
            coordinator.seekAll(idx);
          }
        }, { signal: modeAbort!.signal });
        timelineUi.update(0, coordinator.getFillCounts(), coordinator.getStepDensities());
      }

      // Hydrate from URL if a Wild Tuna track is encoded
      const params = new URLSearchParams(window.location.search);
      const trackParam = params.get("track");
      if (trackParam) {
        const parsed = decodeWildTunaTrackParam(trackParam);
        if (parsed.ok) {
          const payload = parsed.value;
          await drumUi.loadTrackPayload(payload.drum);
          const circleData = payload.loops.find((l) => l.id === "circle");
          const fretData = payload.loops.find((l) => l.id === "fretboard");
          if (circleData?.measures.length) circleLooper.loadLoop(circleData.measures);
          if (fretData?.measures.length) fretboardLooper.loadLoop(fretData.measures);
          // fretboard state: re-enter with restored initialState is not possible post-construction,
          // but fretboardState is updated via onStateChange so we apply it by re-creating the UI
          // would require a refactor; for now, fretboard display state is not restored from URL.
          // Entering via a share URL always opens fullscreen so the player sees the full layout immediately.
          setCarouselHidden(true);
        }
      }
    },
    onExit: () => {
      modeAbort?.abort();
      modeAbort = null;
      liveTrackHoldIds.clear();
      stopTrackRandomnessSync?.();
      stopTrackRandomnessSync = null;
      _trackApi._reset();
      seigaihaBridge.setModeRandomness(null);
      guitarPlayer.stopSustain();
      guitarPlayer.stopAll();
      fretboardPlayer.stopSustain();
      drumUi?.exit();
      drumUi?.destroy();
      drumUi = null;
      jamFlowUi?.destroy();
      jamFlowUi = null;
      circleLooper?.destroy();
      circleLooper = null;
      fretboardLooper?.destroy();
      fretboardLooper = null;
      if (circleLooperHost) circleLooperHost.replaceChildren();
      if (drumHost) drumHost.replaceChildren();
      if (timelineHost) timelineHost.replaceChildren();
      timelineUi = null;
    },
  };
}
