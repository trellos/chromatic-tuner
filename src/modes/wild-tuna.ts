import { createCircleGuitarPlayer } from "../audio/circle-guitar-player.js";
import { createDrumMachineUi, type DrumMachineUi } from "../ui/drum-machine.js";
import { createJamFlowUi, type JamFlowUi, type DiatonicChord } from "../ui/jam-flow.js";
import {
  FRETBOARD_DEFAULT_STATE,
  type FretboardState,
} from "../fretboard-logic.js";
import {
  FRETBOARD_SAMPLE_BASE_MIDI,
  FRETBOARD_SAMPLE_GAIN,
  fetchFretboardSample,
} from "../audio/fretboard-sample.js";
import { createUiCompositeLooper, type CompositeLooper } from "../ui/ui-composite-looper.js";
import { getOrCreateAudioContext } from "../utils.js";
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

// Fixed number of measures shown in the timeline and cycled during playback.
const GLOBAL_MEASURE_COUNT = 4;

// ── Playing Track API ──────────────────────────────────────────────────────
// A unified, aggregated stream of note events from all active loopers.
// Consumers subscribe via `getWildTunaTrackApi()` and listen for note-on/off
// events or poll `getActiveNotes()` for the currently-sounding notes.

export type TrackNoteEvent = {
  /** Which looper fired the event */
  source: "circle" | "fretboard";
  midis: number[];
  durationMs: number;
  /** performance.now() timestamp when the note started */
  startedAt: number;
};

export type ActiveTrackNote = TrackNoteEvent & {
  /** performance.now() timestamp when the note will end */
  endAt: number;
};

export type WildTunaTrackApi = {
  /** Register a handler called when a note starts. Returns an unsubscribe function. */
  onNoteOn: (handler: (event: TrackNoteEvent) => void) => () => void;
  /** Register a handler called when a note ends. Returns an unsubscribe function. */
  onNoteOff: (handler: (event: TrackNoteEvent) => void) => () => void;
  /** Returns a snapshot of all notes that are currently sounding. */
  getActiveNotes: () => ActiveTrackNote[];
};

type TrackApiInternal = WildTunaTrackApi & {
  _emit: (event: TrackNoteEvent) => void;
  _reset: () => void;
};

function buildTrackApi(): TrackApiInternal {
  const noteOnHandlers = new Set<(e: TrackNoteEvent) => void>();
  const noteOffHandlers = new Set<(e: TrackNoteEvent) => void>();
  // Key: `${source}:${midis.join(",")}` — tracks one active slot per source+chord combo.
  const activeNotes = new Map<string, ActiveTrackNote>();
  const endTimeouts = new Map<string, number>();

  return {
    _emit(event) {
      const key = `${event.source}:${event.midis.join(",")}`;
      const prev = endTimeouts.get(key);
      if (prev !== undefined) {
        window.clearTimeout(prev);
        endTimeouts.delete(key);
      }
      noteOnHandlers.forEach((h) => h(event));
      activeNotes.set(key, { ...event, endAt: event.startedAt + event.durationMs });
      const tid = window.setTimeout(() => {
        endTimeouts.delete(key);
        activeNotes.delete(key);
        noteOffHandlers.forEach((h) => h(event));
      }, event.durationMs);
      endTimeouts.set(key, tid);
    },
    _reset() {
      endTimeouts.forEach((tid) => window.clearTimeout(tid));
      endTimeouts.clear();
      activeNotes.clear();
    },
    onNoteOn(handler) {
      noteOnHandlers.add(handler);
      return () => { noteOnHandlers.delete(handler); };
    },
    onNoteOff(handler) {
      noteOffHandlers.add(handler);
      return () => { noteOffHandlers.delete(handler); };
    },
    getActiveNotes() {
      return [...activeNotes.values()];
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

function createLooperCoordinator(getLoopers: () => CompositeLooper[], getDrumUi: () => ReturnType<typeof createDrumMachineUi> | null, getTimelineSteps: () => number) {
  let liveRecording: LiveRecordingState = null;

  return {
    onRecPressed(source: CompositeLooper) {
      const drumUi = getDrumUi();
      // Stop any other actively-recording looper so only one records at a time.
      for (const looper of getLoopers()) {
        if (looper !== source) looper.requestStop();
      }
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
      return GLOBAL_MEASURE_COUNT;
    },
    // Returns how many loopers have recorded content in each measure slot.
    // Values are 0 (empty), 1, or 2 — used for timeline fill coloring.
    // The measure currently being recorded shows 0 (in-progress, not yet committed).
    getFillCounts(): number[] {
      const counts = Array<number>(GLOBAL_MEASURE_COUNT).fill(0);
      for (const looper of getLoopers()) {
        const slots = looper.getMeasureSlots();
        for (let i = 0; i < Math.min(slots.length, GLOBAL_MEASURE_COUNT); i++) {
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
      const densities: number[][] = Array.from({ length: GLOBAL_MEASURE_COUNT }, () =>
        Array<number>(steps).fill(0)
      );
      for (const looper of getLoopers()) {
        const slots = looper.getMeasureSlots();
        for (let mi = 0; mi < Math.min(slots.length, GLOBAL_MEASURE_COUNT); mi++) {
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
        if (liveRecording?.looper === looper && liveRecording.measureIndex >= Math.min(slots.length, GLOBAL_MEASURE_COUNT)) {
          const mi = liveRecording.measureIndex;
          if (mi < GLOBAL_MEASURE_COUNT) {
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
function buildWildTunaTimeline(host: HTMLElement, measureCount: number) {
  let stepsPerBlock = 16;
  const blocks: HTMLElement[] = [];
  const stepSpans: HTMLSpanElement[][] = [];

  function buildBlocks() {
    host.replaceChildren();
    blocks.length = 0;
    stepSpans.length = 0;

    for (let i = 0; i < measureCount; i++) {
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

      host.appendChild(block);
      blocks.push(block);
    }
  }

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
  };
}

function noteCountToRandomness(count: number): number {
  // 0 notes → 0, 1 note → ~0.18, 3 notes → ~0.42, 6+ notes → ~0.78
  return Math.min(0.8, 1 - Math.pow(0.72, count));
}

function createNoteCountTracker(onChange: (randomness: number) => void) {
  let count = 0;
  return {
    notesStarted(noteCount: number, durationMs: number) {
      count += noteCount;
      onChange(noteCountToRandomness(count));
      window.setTimeout(() => {
        count = Math.max(0, count - noteCount);
        onChange(noteCountToRandomness(count));
      }, Math.max(0, durationMs));
    },
    reset() {
      count = 0;
      onChange(0);
    },
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
//   │  playCircleMidis / playFretTargets  →  audio + visual pulse   │
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
  const guitarPlayer = createCircleGuitarPlayer();
  let audioContext: AudioContext | null = null;
  let fretSample: AudioBuffer | null = null;
  const noteTracker = createNoteCountTracker((r) => seigaihaBridge.setModeRandomness(r));

  let sessionTransport = createSessionTransport();

  const ensureAudioContext = async (): Promise<AudioContext | null> => {
    audioContext = await getOrCreateAudioContext(audioContext);
    return audioContext;
  };

  const ensureFretSample = async (ctx: AudioContext): Promise<AudioBuffer | null> => {
    if (fretSample) return fretSample;
    fretSample = await fetchFretboardSample(ctx);
    return fretSample;
  };

  const playFretMidis = async (midis: number[], durationMs: number, shouldRecord: boolean): Promise<void> => {
    if (!midis.length) return;
    if (shouldRecord) fretboardLooper?.recordPulse(midis, durationMs);
    noteTracker.notesStarted(midis.length, durationMs);
    const ctx = await ensureAudioContext();
    if (!ctx) return;
    const sample = await ensureFretSample(ctx);
    const startAt = ctx.currentTime + 0.01;
    midis.forEach((midi) => {
      if (sample) {
        const source = ctx.createBufferSource();
        source.buffer = sample;
        source.playbackRate.value = Math.pow(2, (midi - FRETBOARD_SAMPLE_BASE_MIDI) / 12);
        const gain = ctx.createGain();
        gain.gain.value = FRETBOARD_SAMPLE_GAIN;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(startAt);
        source.stop(startAt + durationMs / 1000);
      }
    });
    jamFlowUi?.pulseTargets(midis.map((midi) => ({ midi, stringIndex: 0 })), durationMs);
  };

  const playCircleMidis = async (midis: number[], durationMs: number, shouldRecord: boolean): Promise<void> => {
    if (!midis.length) return;
    if (shouldRecord) circleLooper?.recordPulse(midis, durationMs);
    noteTracker.notesStarted(midis.length, durationMs);
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

  // Build chord MIDI numbers from a DiatonicChord (respects major/minor/diminished quality).
  function diatonicChordMidis(chord: DiatonicChord): number[] {
    const root = 48 + chord.semitone;
    if (chord.quality === "minor") return [root, root + 3, root + 7];
    if (chord.quality === "diminished") return [root, root + 3, root + 6];
    return [root, root + 4, root + 7]; // major
  }

  return {
    id: "wild-tuna",
    title: "Wild Tuna",
    preserveState: false,
    canFullscreen: true,
    onEnter: async () => {
      noteTracker.reset();
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
        () => drumUi?.getStepsPerBar() ?? 16
      );

      _trackApi._reset();

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
          _trackApi._emit({ source: "circle", ...event, startedAt: performance.now() });
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
          _trackApi._emit({ source: "fretboard", ...event, startedAt: performance.now() });
          void playFretMidis(event.midis, event.durationMs, false);
        },
        onRecButtonPressed: () => coordinator.onRecPressed(fretboardLooper!),
        onRecordingProgress: onRecordingProgress(() => fretboardLooper),
      });

      // Drum machine generates its own DOM; wild-tuna just appends drumUi.rootEl.
      drumUi = createDrumMachineUi({
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

      guitarPlayer.setInstrument("guitar-acoustic");

      jamFlowUi = createJamFlowUi(jamFlowHost, {
        onKeySelect: (semitone) => {
          // Playing a key flower plays its major chord
          void playCircleMidis(majorChordMidis(semitone), 640, true);
        },
        onChordTap: (chord) => {
          // Tap a diatonic chord flower in key-zoom mode → play that chord
          void playCircleMidis(diatonicChordMidis(chord), 640, true);
        },
        onNoteBarTap: (semitone) => {
          void playCircleMidis([48 + semitone], 380, true);
        },
        onFretDotTap: (midi) => {
          void playFretMidis([midi], 360, true);
        },
      });
      jamFlowUi.enter();
      await drumUi.enter();

      if (timelineHost) {
        timelineUi = buildWildTunaTimeline(timelineHost, coordinator.getMaxMeasureCount());
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
      _trackApi._reset();
      seigaihaBridge.setModeRandomness(null);
      guitarPlayer.stopSustain();
      guitarPlayer.stopAll();
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
