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
import { createUiCompositeLooper, type CompositeLooper, type CompositeLooperMeasureSlot } from "../ui/ui-composite-looper.js";
import { getOrCreateAudioContext } from "../utils.js";
import type { ModeDefinition } from "./types.js";
import { seigaihaBridge } from "../app/seigaiha-bridge.js";
import { setCarouselHidden } from "../app/carousel-bridge.js";

const WILD_TUNA_TRACK_VERSION = 1;

type WildTunaTrackPayload = {
  v: number;
  drum: string;
  fret: FretboardState;
  loops: Array<{ id: string; measures: CompositeLooperMeasureSlot[] }>;
};

const toBase64Url = (value: string) =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const fromBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
};

function serializeWildTunaShareUrl(
  drumUi: DrumMachineUi,
  circleLooper: CompositeLooper,
  fretboardLooper: CompositeLooper,
  fretState: FretboardState
): string {
  const payload: WildTunaTrackPayload = {
    v: WILD_TUNA_TRACK_VERSION,
    drum: drumUi.getTrackPayload(),
    fret: { ...fretState },
    loops: [
      { id: "circle", measures: circleLooper.getMeasureSlots() },
      { id: "fretboard", measures: fretboardLooper.getMeasureSlots() },
    ],
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  const url = new URL(window.location.href);
  url.searchParams.set("mode", "wild-tuna");
  url.searchParams.set("track", encoded);
  return url.toString();
}

function parseWildTunaTrackPayload(encoded: string): WildTunaTrackPayload | null {
  try {
    const raw = fromBase64Url(encoded);
    const parsed = JSON.parse(raw) as Partial<WildTunaTrackPayload>;
    if (parsed.v !== WILD_TUNA_TRACK_VERSION) return null;
    if (typeof parsed.drum !== "string") return null;
    if (!parsed.fret || typeof parsed.fret !== "object") return null;
    if (!Array.isArray(parsed.loops)) return null;
    return parsed as WildTunaTrackPayload;
  } catch {
    return null;
  }
}

// Fixed number of measures shown in the timeline and cycled during playback.
const GLOBAL_MEASURE_COUNT = 4;

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
  };
}

// Builds the row of measure-indicator buttons between the drum machine and
// Circle/Fretboard panes. Each block is tappable to seek all loopers.
// `update(currentMeasure, fillCounts)` refreshes highlight + fill color.
function buildWildTunaTimeline(host: HTMLElement, measureCount: number) {
  host.replaceChildren();
  const blocks: HTMLElement[] = [];
  for (let i = 0; i < measureCount; i++) {
    const block = document.createElement("button");
    block.type = "button";
    block.className = "wt-timeline-block";
    block.dataset.measure = String(i);
    block.setAttribute("aria-label", `Measure ${i + 1}`);
    host.appendChild(block);
    blocks.push(block);
  }
  return {
    update(currentMeasure: number, fillCounts: number[]) {
      blocks.forEach((block, i) => {
        block.classList.toggle("is-current", i === currentMeasure);
        block.dataset.fill = String(Math.min(fillCounts[i] ?? 0, 2));
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
//   - globalMeasureIndex is tracked separately from each looper's
//     internal playbackMeasureIndex so the timeline can display a
//     single authoritative position independent of loop lengths.
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
  let globalMeasureIndex = 0;
  const guitarPlayer = createCircleGuitarPlayer();
  let audioContext: AudioContext | null = null;
  let fretSample: AudioBuffer | null = null;
  const noteTracker = createNoteCountTracker((r) => seigaihaBridge.setModeRandomness(r));

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

      circleLooper = createUiCompositeLooper({
        getMeasureDurationMs: () => ((60 / Math.max(1, drumUi?.getBpm() ?? 120)) * 4 * 1000),
        onPlaybackEvent: (event) => {
          void playCircleMidis(event.midis, event.durationMs, false);
        },
        onRecButtonPressed: () => coordinator.onRecPressed(circleLooper!),
      });
      circleLooperHost.replaceChildren(circleLooper.rootEl);

      fretboardLooper = createUiCompositeLooper({
        getMeasureDurationMs: () => ((60 / Math.max(1, drumUi?.getBpm() ?? 120)) * 4 * 1000),
        onPlaybackEvent: (event) => {
          const targets = event.midis.map((midi) => ({ midi, stringIndex: 0 }));
          void playFretTargets(targets, event.durationMs, false);
        },
        onRecButtonPressed: () => coordinator.onRecPressed(fretboardLooper!),
      });

      // Drum machine generates its own DOM; wild-tuna just appends drumUi.rootEl.
      drumUi = createDrumMachineUi({
        onTransportStart: () => {
          // Reset measure counter so the first onBeatBoundary increments to 0.
          globalMeasureIndex = -1;
          circleLooper?.onTransportStart();
          fretboardLooper?.onTransportStart();
          timelineUi?.update(0, coordinator.getFillCounts());
        },
        onTransportStop: () => {
          globalMeasureIndex = -1;
          circleLooper?.onTransportStop();
          fretboardLooper?.onTransportStop();
        },
        onBeatBoundary: (event) => {
          // Forward beat events to both loopers so they can advance state.
          circleLooper?.onBeatBoundary(event);
          fretboardLooper?.onBeatBoundary(event);
          // Update the global timeline indicator once per measure (beat 0).
          if (event.beatIndex === 0) {
            globalMeasureIndex = (globalMeasureIndex + 1) % Math.max(1, coordinator.getMaxMeasureCount());
            timelineUi?.update(globalMeasureIndex, coordinator.getFillCounts());
          }
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

      circleUi = createCircleOfFifthsUi(circleHost, {
        onPrimaryTap: (selection) => {
          void playCircleMidis([selection.primaryMidi], 380, true);
        },
        onInnerDoubleTap: () => {
          const instrumentName = guitarPlayer.cycleInstrument();
          circleUi?.setInstrumentLabel(instrumentName);
          circleUi?.showInnerIndicator(instrumentName);
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
          const midis = getCircleMajorChordMidis(note.midi);
          circleLooper?.recordHoldStart(`circle-major-${note.midi}`, midis);
          circleUi?.holdChord(midis);
          void guitarPlayer.startSustainChord(midis);
        },
        onOuterPressEnd: (note) => {
          circleLooper?.recordHoldEnd(`circle-major-${note.midi}`);
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
            // Adjust globalMeasureIndex so that the next onBeatBoundary increment
            // lands on the tapped measure (idx). The increment adds 1, so set
            // globalMeasureIndex to idx - 1 (wrapping around).
            globalMeasureIndex = (idx - 1 + coordinator.getMaxMeasureCount()) % coordinator.getMaxMeasureCount();
            timelineUi?.update(idx, coordinator.getFillCounts());
            coordinator.seekAll(idx);
          }
        }, { signal: modeAbort!.signal });
        timelineUi.update(0, coordinator.getFillCounts());
      }

      // Hydrate from URL if a Wild Tuna track is encoded
      const params = new URLSearchParams(window.location.search);
      const trackParam = params.get("track");
      if (trackParam) {
        const payload = parseWildTunaTrackPayload(trackParam);
        if (payload) {
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
