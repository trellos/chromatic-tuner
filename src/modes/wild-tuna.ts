import { createCircleGuitarPlayer } from "../audio/circle-guitar-player.js";
import { createCircleOfFifthsUi, getCircleChordMidis, getCircleMajorChordMidis } from "../ui/circle-of-fifths.js";
import { createDrumMachineUi, type DrumMachineUi } from "../ui/drum-machine.js";
import { createFretboardUi } from "../ui/fretboard.js";
import {
  getChordTapPlaybackTargets,
  getKeyTapPlaybackTargets,
  NOTE_TO_SEMITONE,
  FRETBOARD_DEFAULT_STATE,
  type CharacteristicType,
  type FretboardPlaybackTarget,
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
  encodeWildTunaTrackPayloadV2,
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
    ? encodeWildTunaTrackPayloadV2(payload, drumDecoded.value)
    : encodeWildTunaTrackPayloadV2(payload, { version: 1, bpm: 120, kit: "rock", steps: "0".repeat(64) });
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
function createLooperCoordinator(getLoopers: () => CompositeLooper[], getDrumUi: () => ReturnType<typeof createDrumMachineUi> | null) {
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
    // Seek all loopers to a specific measure index (used by timeline click).
    seekAll(measureIndex: number) {
      for (const looper of getLoopers()) looper.seekToMeasure(measureIndex);
    },
    getMaxMeasureCount() {
      return GLOBAL_MEASURE_COUNT;
    },
    // Returns how many loopers have recorded content in each measure slot.
    // Values are 0 (empty), 1, or 2 — used for timeline fill coloring.
    getFillCounts(): number[] {
      const counts = Array<number>(GLOBAL_MEASURE_COUNT).fill(0);
      for (const looper of getLoopers()) {
        const slots = looper.getMeasureSlots();
        for (let i = 0; i < Math.min(slots.length, GLOBAL_MEASURE_COUNT); i++) {
          if ((slots[i]?.events.length ?? 0) > 0) counts[i] = (counts[i] ?? 0) + 1;
        }
      }
      return counts;
    },
    // Returns a 2D array [measureIndex][stepIndex] with the total note count
    // across all loopers for that step. A note spans startStep..endStep, so
    // it contributes to every step in that range.
    getStepDensities(): number[][] {
      const STEPS = 16;
      const densities: number[][] = Array.from({ length: GLOBAL_MEASURE_COUNT }, () =>
        Array<number>(STEPS).fill(0)
      );
      for (const looper of getLoopers()) {
        const slots = looper.getMeasureSlots();
        for (let mi = 0; mi < Math.min(slots.length, GLOBAL_MEASURE_COUNT); mi++) {
          const events = slots[mi]?.events ?? [];
          for (const event of events) {
            const noteCount = event.midis.length;
            for (let s = event.startStep; s < Math.min(event.endStep, STEPS); s++) {
              (densities[mi] as number[])[s] = ((densities[mi] as number[])[s] ?? 0) + noteCount;
            }
          }
        }
      }
      return densities;
    },
  };
}

const TIMELINE_STEPS = 16;

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
// Each block contains 16 mini step-slots that light up based on note density.
// `update(currentMeasure, fillCounts, stepDensities)` refreshes all visuals.
function buildWildTunaTimeline(host: HTMLElement, measureCount: number) {
  host.replaceChildren();
  const blocks: HTMLElement[] = [];
  // stepSpans[i] is the array of 16 step-slot spans for measure i.
  const stepSpans: HTMLSpanElement[][] = [];

  for (let i = 0; i < measureCount; i++) {
    const block = document.createElement("button");
    block.type = "button";
    block.className = "wt-timeline-block";
    block.dataset.measure = String(i);
    block.setAttribute("aria-label", `Measure ${i + 1}`);

    const spans: HTMLSpanElement[] = [];
    for (let s = 0; s < TIMELINE_STEPS; s++) {
      const span = document.createElement("span");
      span.className = "wt-timeline-step";
      block.appendChild(span);
      spans.push(span);
    }
    stepSpans.push(spans);

    host.appendChild(block);
    blocks.push(block);
  }
  return {
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
  const circleHost = modeEl.querySelector<HTMLElement>("[data-wild-tuna-circle]");
  const circleLooperHost = modeEl.querySelector<HTMLElement>("[data-wild-tuna-circle-looper]");
  const fretboardHost = modeEl.querySelector<HTMLElement>("[data-wild-tuna-fretboard]");
  const timelineHost = modeEl.querySelector<HTMLElement>("[data-wild-tuna-timeline]");
  const fullscreenTrigger = modeEl.querySelector<HTMLButtonElement>("[data-wild-tuna-fullscreen]");
  let modeAbort: AbortController | null = null;
  let timelineUi: ReturnType<typeof buildWildTunaTimeline> | null = null;
  let drumUi: ReturnType<typeof createDrumMachineUi> | null = null;
  let circleUi: ReturnType<typeof createCircleOfFifthsUi> | null = null;
  let circleLooper: CompositeLooper | null = null;
  let fretboardUi: ReturnType<typeof createFretboardUi> | null = null;
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

  const playFretTargets = async (targets: FretboardPlaybackTarget[], durationMs: number, shouldRecord: boolean): Promise<void> => {
    if (!targets.length) return;
    if (shouldRecord) fretboardLooper?.recordPulse(targets.map((target) => target.midi), durationMs);
    noteTracker.notesStarted(targets.length, durationMs);
    const ctx = await ensureAudioContext();
    if (!ctx) return;
    const sample = await ensureFretSample(ctx);
    const startAt = ctx.currentTime + 0.01;
    targets.forEach((target) => {
      if (sample) {
        const source = ctx.createBufferSource();
        source.buffer = sample;
        source.playbackRate.value = Math.pow(2, (target.midi - FRETBOARD_SAMPLE_BASE_MIDI) / 12);
        const gain = ctx.createGain();
        gain.gain.value = FRETBOARD_SAMPLE_GAIN;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(startAt);
        source.stop(startAt + durationMs / 1000);
      }
    });
    fretboardUi?.pulseTargets(targets, durationMs);
  };

  const playCircleMidis = async (midis: number[], durationMs: number, shouldRecord: boolean): Promise<void> => {
    if (!midis.length) return;
    if (shouldRecord) circleLooper?.recordPulse(midis, durationMs);
    noteTracker.notesStarted(midis.length, durationMs);
    if (midis.length === 1) {
      const midi = midis[0];
      if (midi === undefined) return;
      circleUi?.pulseNote(midi, durationMs);
      await guitarPlayer.playMidi(midi, durationMs);
      return;
    }
    circleUi?.pulseChord(midis, durationMs);
    await guitarPlayer.playChord(midis, durationMs);
  };

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
      if (!drumHost || !circleHost || !circleLooperHost || !fretboardHost) return;

      const fretboardTemplate = document.querySelector<HTMLTemplateElement>("#fretboard-template");
      fretboardHost.replaceChildren(
        fretboardTemplate ? fretboardTemplate.content.cloneNode(true) : document.createDocumentFragment()
      );

      // Coordinator is created first so the loopers can reference it in
      // their onRecButtonPressed callbacks (circular reference via closures).
      const coordinator = createLooperCoordinator(
        () => {
          const loopers: CompositeLooper[] = [];
          if (circleLooper) loopers.push(circleLooper);
          if (fretboardLooper) loopers.push(fretboardLooper);
          return loopers;
        },
        () => drumUi
      );

      _trackApi._reset();

      circleLooper = createUiCompositeLooper({
        getMeasureDurationMs: () => ((60 / Math.max(1, drumUi?.getBpm() ?? 120)) * 4 * 1000),
        onPlaybackEvent: (event) => {
          _trackApi._emit({ source: "circle", ...event, startedAt: performance.now() });
          void playCircleMidis(event.midis, event.durationMs, false);
        },
        onRecButtonPressed: () => coordinator.onRecPressed(circleLooper!),
      });
      circleLooperHost.replaceChildren(circleLooper.rootEl);

      fretboardLooper = createUiCompositeLooper({
        getMeasureDurationMs: () => ((60 / Math.max(1, drumUi?.getBpm() ?? 120)) * 4 * 1000),
        onPlaybackEvent: (event) => {
          _trackApi._emit({ source: "fretboard", ...event, startedAt: performance.now() });
          const targets = event.midis.map((midi) => ({ midi, stringIndex: 0 }));
          void playFretTargets(targets, event.durationMs, false);
        },
        onRecButtonPressed: () => coordinator.onRecPressed(fretboardLooper!),
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
      });
      drumHost.replaceChildren(drumUi.rootEl);

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

      // Track whether a press-start was handled so the follow-up tap (which
      // fires as a click after pointerup) doesn't replay the same chord.
      let suppressOuterTap = false;

      circleUi = createCircleOfFifthsUi(circleHost, {
        onOuterTap: (note) => {
          if (suppressOuterTap) {
            suppressOuterTap = false;
            return;
          }
          if (note.zone === "chord") {
            void playCircleMidis(getCircleMajorChordMidis(note.midi), 640, true);
          } else {
            void playCircleMidis([note.midi], 380, true);
          }
        },
        onInnerDoubleTap: () => {
          const instrumentName = guitarPlayer.cycleInstrument();
          circleUi?.setInstrumentLabel(instrumentName);
          circleUi?.showInnerIndicator(instrumentName);
        },
        onNoteBarTap: (note) => {
          void playCircleMidis([note.midi], 380, true);
        },
        onNoteBarPressStart: (note) => {
          circleLooper?.recordHoldStart(`circle-note-${note.midi}`, [note.midi]);
          circleUi?.holdNote(note.midi);
          void guitarPlayer.startSustainMidi(note.midi);
        },
        onNoteBarPressEnd: (note) => {
          circleLooper?.recordHoldEnd(`circle-note-${note.midi}`);
          circleUi?.releaseHeldNotes();
          guitarPlayer.stopSustain();
        },
        onSecondaryPressStart: (chord) => {
          const chordMidis = getCircleChordMidis(chord);
          circleLooper?.recordHoldStart(`circle-secondary-${chord.rootMidi}`, chordMidis);
          circleUi?.holdChord(chordMidis);
          void guitarPlayer.startSustainChord(chordMidis);
        },
        onSecondaryPressEnd: (chord) => {
          circleLooper?.recordHoldEnd(`circle-secondary-${chord.rootMidi}`);
          circleUi?.releaseHeldNotes();
          guitarPlayer.stopSustain();
        },
        onOuterPressStart: (note) => {
          if (note.zone === "note") {
            // CCW zone press: play single note hold. Do not suppress the tap
            // event — there is no follow-up click to suppress since the tap
            // fires on press, not on release.
            circleLooper?.recordHoldStart(`circle-single-${note.midi}`, [note.midi]);
            circleUi?.holdNote(note.midi);
            void guitarPlayer.startSustainMidi(note.midi);
            return;
          }
          // CW zone press: chord sustain. Suppress the follow-up tap click.
          suppressOuterTap = true;
          const midis = getCircleMajorChordMidis(note.midi);
          circleLooper?.recordHoldStart(`circle-major-${note.midi}`, midis);
          circleUi?.holdChord(midis);
          void guitarPlayer.startSustainChord(midis);
        },
        onOuterPressEnd: (note) => {
          circleLooper?.recordHoldEnd(
            note.zone === "note" ? `circle-single-${note.midi}` : `circle-major-${note.midi}`
          );
          circleUi?.releaseHeldNotes();
          guitarPlayer.stopSustain();
        },
      });
      circleUi.setInstrumentLabel(guitarPlayer.setInstrument("guitar-acoustic"));

      fretboardUi = createFretboardUi(fretboardHost, {
        initialState: FRETBOARD_DEFAULT_STATE,
        controlsHidden: false,
        onStateChange: (nextState) => {
          fretboardState = nextState;
        },
        onPlayPress: () => {
          const rootMidi = FRETBOARD_SAMPLE_BASE_MIDI + (NOTE_TO_SEMITONE[fretboardState.root] ?? 0);
          void playFretTargets([{ midi: rootMidi, stringIndex: 0, isRoot: true }], 360, true);
        },
        onFretPress: ({ midi, stringIndex, fret }) => {
          if (fretboardState.display === "chord") {
            const chordTargets = getChordTapPlaybackTargets({
              chordRoot: fretboardState.root,
              characteristic: fretboardState.characteristic as CharacteristicType,
              tappedMidi: midi,
              tappedStringIndex: stringIndex,
            });
            void playFretTargets(chordTargets, 560, true);
            return;
          }
          if (fretboardState.display === "key") {
            const keyTargets = getKeyTapPlaybackTargets({
              keyRoot: fretboardState.root,
              keyMode: fretboardState.characteristic,
              tappedMidi: midi,
              tappedStringIndex: stringIndex,
            });
            void playFretTargets(keyTargets, 560, true);
            return;
          }
          void playFretTargets([{ midi, stringIndex, isRoot: fret === 0 }], 360, true);
        },
      });
      fretboardUi.setLooperElement(fretboardLooper.rootEl);
      fretboardUi.enter();
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
      circleUi?.destroy();
      circleUi = null;
      circleLooper?.destroy();
      circleLooper = null;
      fretboardUi?.setLooperElement(null);
      fretboardUi?.exit();
      fretboardUi = null;
      fretboardLooper?.destroy();
      fretboardLooper = null;
      if (circleLooperHost) circleLooperHost.replaceChildren();
      if (circleHost) circleHost.replaceChildren();
      if (drumHost) drumHost.replaceChildren();
      if (fretboardHost) fretboardHost.replaceChildren();
      if (timelineHost) timelineHost.replaceChildren();
      timelineUi = null;
    },
  };
}
