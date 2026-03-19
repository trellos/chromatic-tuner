import type { LooperRecorder } from "./looper-recordable.js";
import { clamp } from "../utils.js";

const DEFAULT_STEPS_PER_MEASURE = 16;
const MAX_MEASURES = 4;
const MIN_EVENT_STEPS = 1;
const SAFE_MEASURE_DURATION_MS = 2000;
const BEAT_PULSE_MS = 180;

export type LooperRecordState = "idle" | "armed" | "recording" | "stopping";

type QuantizedNoteEvent = {
  midis: number[];
  startStep: number;
  endStep: number;
};

type MeasureSlot = {
  events: QuantizedNoteEvent[];
};

type ActiveRecordedNote = {
  midis: number[];
  startStep: number;
};

export type CompositeLooperBeatBoundaryEvent = {
  beatIndex: number;
  beatsPerBar: number;
  scheduledPerfMs?: number;
};

export type CompositeLooperMeasureSlot = {
  events: Array<{ midis: number[]; startStep: number; endStep: number }>;
};

export type CompositeLooperOptions = {
  getMeasureDurationMs: () => number;
  /** Returns the current step resolution per measure (8 or 16). Defaults to 16 if omitted. */
  getStepsPerMeasure?: () => number;
  onPlaybackEvent: (event: {
    measureIndex: number;
    midis: number[];
    durationMs: number;
  }) => void;
  /** Called when the REC button is pressed while idle, before arming. Coordinator uses this to stop other loopers. */
  onRecButtonPressed?: () => void;
  /**
   * Called whenever in-progress recording state changes: a note is quantized,
   * a new measure starts recording, or recording stops. Receives the measure
   * index being recorded (-1 when not recording) and a snapshot of the events
   * committed so far in the current measure.
   */
  onRecordingProgress?: (measureIndex: number, events: Array<{ midis: number[]; startStep: number; endStep: number }>) => void;
};

export type CompositeLooper = LooperRecorder & {
  rootEl: HTMLElement;
  onTransportStart: () => void;
  onTransportStop: () => void;
  onBeatBoundary: (event: CompositeLooperBeatBoundaryEvent) => void;
  destroy: () => void;
  // Coordinator API
  requestArm: () => void;
  requestStop: () => void;
  getRecordState: () => LooperRecordState;
  getLoopMeasureCount: () => number;
  seekToMeasure: (index: number) => void;
  loadLoop: (slots: CompositeLooperMeasureSlot[]) => void;
  getMeasureSlots: () => CompositeLooperMeasureSlot[];
};

function sanitizeMidis(midis: number[]): number[] {
  return midis
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.round(value));
}

function hasStoredContent(slots: MeasureSlot[]): boolean {
  return slots.some((slot) => slot.events.length > 0);
}

export function createUiCompositeLooper(options: CompositeLooperOptions): CompositeLooper {
  const stepsPerMeasure = () => options.getStepsPerMeasure?.() ?? DEFAULT_STEPS_PER_MEASURE;

  const rootEl = document.createElement("section");
  rootEl.className = "ui-composite-looper";
  rootEl.setAttribute("aria-label", "Loop recorder");
  rootEl.dataset.looperState = "idle";

  const controlRow = document.createElement("div");
  controlRow.className = "ui-composite-looper-controls";
  rootEl.appendChild(controlRow);

  const recButton = document.createElement("button");
  recButton.className = "ui-composite-looper-btn ui-composite-looper-btn--rec";
  recButton.type = "button";
  recButton.setAttribute("aria-label", "Record loop");
  recButton.dataset.looperRec = "1";
  const recDot = document.createElement("span");
  recDot.className = "ui-composite-looper-rec-dot";
  recButton.appendChild(recDot);
  const recLabel = document.createElement("span");
  recLabel.textContent = "REC";
  recButton.appendChild(recLabel);
  controlRow.appendChild(recButton);

  const clearButton = document.createElement("button");
  clearButton.className = "ui-composite-looper-btn ui-composite-looper-btn--clear";
  clearButton.type = "button";
  clearButton.textContent = "CLR";
  clearButton.setAttribute("aria-label", "Clear loop");
  controlRow.appendChild(clearButton);

  const measureSlots: MeasureSlot[] = [];
  const activeRecordedNotesBySource = new Map<string, ActiveRecordedNote>();
  // Notes played while armed (before the first measure boundary) are buffered here.
  // They flush into activeRecordedNotesBySource at step 0 when recording actually starts.
  // durationMs is stored so each pulse gets a proper close timeout after flushing.
  const preArmBuffer = new Map<string, { midis: number[]; durationMs: number }>();
  const playbackTimeoutIds = new Set<number>();
  const pulseEndTimeoutIds = new Set<number>();
  const recordPulseTimeoutIds = new Set<number>();

  let loopMeasureCount = 0;
  let recordState: LooperRecordState = "idle";
  let isTransportPlaying = false;
  // -1 sentinel: first boundary increments to 0, giving a clean start without a flag.
  let playbackMeasureIndex = -1;
  let nextWriteMeasureIndex = 0;
  let recordingMeasureIndex: number | null = null;
  let recordedMeasuresInPass = 0;
  let currentRecordingEvents: QuantizedNoteEvent[] = [];
  let currentMeasureStartPerfMs: number | null = null;
  let currentMeasureDurationMs = SAFE_MEASURE_DURATION_MS;
  let pulseEventSeq = 0;
  let pendingSeekMeasure: number | null = null;
  // Separate from pendingSeekMeasure: set by seekToMeasure, consumed only by requestArm.
  // This ensures a queued recording target survives count-in beat boundaries.
  let recordingSeekTarget: number | null = null;


  const clearTimeoutSet = (timeouts: Set<number>): void => {
    timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    timeouts.clear();
  };

  const readMeasureDurationMs = (): number => {
    const raw = options.getMeasureDurationMs();
    if (!Number.isFinite(raw)) return SAFE_MEASURE_DURATION_MS;
    return clamp(raw, 420, 8000);
  };

  const getQuantizedStartStep = (eventPerfMs: number): number => {
    if (currentMeasureStartPerfMs === null) return 0;
    const ratio = (eventPerfMs - currentMeasureStartPerfMs) / Math.max(1, currentMeasureDurationMs);
    // Round to nearest step boundary so notes played slightly ahead of the beat
    // snap forward (to the beat) rather than backward (to the previous grid slot).
    return clamp(Math.round(ratio * stepsPerMeasure()), 0, stepsPerMeasure() - 1);
  };

  const getQuantizedEndStep = (eventPerfMs: number, startStep: number): number => {
    if (currentMeasureStartPerfMs === null) {
      return clamp(startStep + MIN_EVENT_STEPS, 1, stepsPerMeasure());
    }
    const ratio = (eventPerfMs - currentMeasureStartPerfMs) / Math.max(1, currentMeasureDurationMs);
    // Round end to nearest step boundary, then enforce minimum note duration.
    const rawEnd = Math.round(ratio * stepsPerMeasure());
    const minEnd = startStep + MIN_EVENT_STEPS;
    return clamp(rawEnd, minEnd, stepsPerMeasure());
  };

  const notifyRecordingProgress = (): void => {
    if (!options.onRecordingProgress) return;
    options.onRecordingProgress(
      recordingMeasureIndex ?? -1,
      currentRecordingEvents.map((e) => ({ ...e, midis: [...e.midis] }))
    );
  };

  const pushQuantizedEvent = (midis: number[], startStep: number, endStep: number): void => {
    const cleanedMidis = sanitizeMidis(midis);
    if (!cleanedMidis.length) return;
    const normalizedStart = clamp(startStep, 0, stepsPerMeasure() - 1);
    const normalizedEnd = clamp(
      endStep,
      normalizedStart + MIN_EVENT_STEPS,
      stepsPerMeasure()
    );
    if (normalizedEnd <= normalizedStart) return;
    currentRecordingEvents.push({
      midis: cleanedMidis,
      startStep: normalizedStart,
      endStep: normalizedEnd,
    });
    notifyRecordingProgress();
  };

  const isRecordingOpen = (): boolean => {
    return recordState === "recording" || recordState === "stopping";
  };

  const closeActiveRecordedSource = (sourceId: string, eventPerfMs: number): void => {
    if (!isRecordingOpen()) return;
    const active = activeRecordedNotesBySource.get(sourceId);
    if (!active) return;
    const endStep = getQuantizedEndStep(eventPerfMs, active.startStep);
    pushQuantizedEvent(active.midis, active.startStep, endStep);
    activeRecordedNotesBySource.delete(sourceId);
  };

  const closeAllActiveNotesAtMeasureEnd = (): void => {
    activeRecordedNotesBySource.forEach((active) => {
      pushQuantizedEvent(active.midis, active.startStep, stepsPerMeasure());
      active.startStep = 0;
    });
  };

  const finalizeRecordedMeasure = (): void => {
    if (recordingMeasureIndex === null) return;
    closeAllActiveNotesAtMeasureEnd();
    const finalizedEvents = currentRecordingEvents
      .map((event) => ({ ...event, midis: [...event.midis] }))
      .sort((left, right) => left.startStep - right.startStep);
    // Write to the specific measure slot (overwrite if it already exists).
    measureSlots[recordingMeasureIndex] = { events: finalizedEvents };
    currentRecordingEvents = [];
    recordedMeasuresInPass += 1;
    // Advance write index; wrap around the loop when overwriting existing content.
    const writeCount = loopMeasureCount > 0 ? loopMeasureCount : MAX_MEASURES;
    nextWriteMeasureIndex = (recordingMeasureIndex + 1) % writeCount;
    if (recordedMeasuresInPass >= MAX_MEASURES && recordState === "recording") {
      recordState = "stopping";
    }
  };

  const stopRecordingAtBoundary = (): void => {
    // Extend loopMeasureCount if we recorded new slots beyond the previous loop.
    loopMeasureCount = Math.max(loopMeasureCount, measureSlots.length);
    recordState = "idle";
    recordingMeasureIndex = null;
    recordedMeasuresInPass = 0;
    activeRecordedNotesBySource.clear();
    currentRecordingEvents = [];
    notifyRecordingProgress();
  };

  const startRecordingMeasure = (measureIndex: number): void => {
    recordingMeasureIndex = measureIndex;
    currentRecordingEvents = [];
    activeRecordedNotesBySource.clear();
    notifyRecordingProgress();
    // Flush notes that were played while armed (before this boundary) into step 0
    // so they aren't silently dropped. Schedule a close timeout per entry so
    // pre-arm pulses get correct duration rather than spanning the full measure.
    preArmBuffer.forEach((entry, sourceId) => {
      activeRecordedNotesBySource.set(sourceId, { midis: entry.midis, startStep: 0 });
      // durationMs > 0 = pulse: schedule auto-close. 0 = open hold: wait for recordHoldEnd.
      if (entry.durationMs > 0) {
        const timeoutId = window.setTimeout(() => {
          recordPulseTimeoutIds.delete(timeoutId);
          closeActiveRecordedSource(sourceId, performance.now());
        }, entry.durationMs);
        recordPulseTimeoutIds.add(timeoutId);
      }
    });
    preArmBuffer.clear();
    recordState = "recording";
  };

  const triggerTransientClass = (element: Element, className: string, durationMs: number): void => {
    element.classList.remove(className);
    // Reflow so repeated beat pulses restart the animation.
    void (element as HTMLElement).offsetWidth;
    element.classList.add(className);
    const timeoutId = window.setTimeout(() => {
      pulseEndTimeoutIds.delete(timeoutId);
      element.classList.remove(className);
    }, durationMs);
    pulseEndTimeoutIds.add(timeoutId);
  };

  const schedulePlaybackForMeasure = (measureIndex: number, measureStartPerfMs: number): void => {
    if (!isTransportPlaying) return;
    if (isRecordingOpen()) return;
    const slot = measureSlots[measureIndex];
    if (!slot || slot.events.length === 0) return;
    const stepDurationMs = currentMeasureDurationMs / stepsPerMeasure();
    slot.events.forEach((event) => {
      const eventDelayMs = Math.max(
        0,
        measureStartPerfMs + event.startStep * stepDurationMs - performance.now()
      );
      const eventDurationMs = Math.max(
        stepDurationMs,
        (event.endStep - event.startStep) * stepDurationMs
      );
      const timeoutId = window.setTimeout(() => {
        playbackTimeoutIds.delete(timeoutId);
        options.onPlaybackEvent({
          measureIndex,
          midis: [...event.midis],
          durationMs: eventDurationMs,
        });
      }, eventDelayMs);
      playbackTimeoutIds.add(timeoutId);
    });
  };

  const updateUi = (): void => {
    const hasRecording = hasStoredContent(measureSlots);
    rootEl.classList.toggle("is-transport-playing", isTransportPlaying);
    rootEl.classList.toggle("is-transport-stopped", !isTransportPlaying);
    rootEl.classList.toggle("is-armed", recordState === "armed");
    rootEl.classList.toggle(
      "is-recording",
      recordState === "recording" || recordState === "stopping"
    );
    rootEl.classList.toggle("is-stop-queued", recordState === "stopping");
    rootEl.classList.toggle("has-recording", hasRecording);
    rootEl.classList.toggle("is-rec-active", recordState !== "idle");
    rootEl.dataset.looperState = recordState;
    recButton.setAttribute("aria-pressed", String(recordState !== "idle"));
    recButton.setAttribute("aria-label", recordState === "idle" ? "Record loop" : "Recording control");
    recButton.disabled = false;
    clearButton.disabled = !hasRecording || recordState !== "idle";

  };

  const onControlButtonClick = (): void => {
    if (recordState === "idle") {
      options.onRecButtonPressed?.();
      // requestArm() will be called by coordinator (or directly if no coordinator)
      return;
    }
    if (recordState === "armed") {
      recordState = "idle";
      updateUi();
      return;
    }
    if (recordState === "recording") {
      recordState = "stopping";
      updateUi();
    }
  };

  const onMeasureBoundary = (measureStartPerfMs: number): void => {
    currentMeasureDurationMs = readMeasureDurationMs();
    currentMeasureStartPerfMs = measureStartPerfMs;

    if (pendingSeekMeasure !== null) {
      playbackMeasureIndex = pendingSeekMeasure;
      pendingSeekMeasure = null;
    } else {
      // -1 sentinel: first call yields (−1+1)%effectiveCount = 0.
      const effectiveCount = loopMeasureCount > 0 ? loopMeasureCount : 1;
      playbackMeasureIndex = (playbackMeasureIndex + 1) % effectiveCount;
    }

    if (recordState === "recording" || recordState === "stopping") {
      finalizeRecordedMeasure();
    }

    if (recordState === "stopping") {
      stopRecordingAtBoundary();
    } else if (recordState === "armed" || recordState === "recording") {
      startRecordingMeasure(nextWriteMeasureIndex);
    }

    schedulePlaybackForMeasure(playbackMeasureIndex, measureStartPerfMs);
    updateUi();
  };

  recButton.addEventListener("click", onControlButtonClick);
  clearButton.addEventListener("click", () => {
    if (recordState !== "idle") return;
    measureSlots.length = 0;
    loopMeasureCount = 0;
    updateUi();
  });
  updateUi();

  return {
    rootEl,
    onTransportStart() {
      // If armed or recording (count-in path where requestArm() fired before
      // startTransport()), do not clobber currentMeasureStartPerfMs or reset
      // the playback index — recording state is already correctly initialised.
      if (recordState === "armed" || recordState === "recording") {
        isTransportPlaying = true;
        updateUi();
        return;
      }
      isTransportPlaying = true;
      playbackMeasureIndex = -1;
      currentMeasureStartPerfMs = null;
      currentMeasureDurationMs = readMeasureDurationMs();
      updateUi();
    },
    onTransportStop() {
      isTransportPlaying = false;
      playbackMeasureIndex = -1;
      currentMeasureStartPerfMs = null;
      clearTimeoutSet(playbackTimeoutIds);
      clearTimeoutSet(recordPulseTimeoutIds);
      if (isRecordingOpen() || recordState === "armed") {
        preArmBuffer.clear();
        activeRecordedNotesBySource.clear();
        currentRecordingEvents = [];
        recordState = "idle";
        recordingMeasureIndex = null;
        recordedMeasuresInPass = 0;
        notifyRecordingProgress();
      }
      rootEl.classList.remove("is-beat-pulse");
      updateUi();
    },
    onBeatBoundary(event) {
      if (!isTransportPlaying) return;
      triggerTransientClass(rootEl, "is-beat-pulse", BEAT_PULSE_MS);
      if (event.beatIndex !== 0) {
        updateUi();
        return;
      }
      const measureStartPerfMs = Number.isFinite(event.scheduledPerfMs)
        ? (event.scheduledPerfMs as number)
        : performance.now();
      onMeasureBoundary(measureStartPerfMs);
    },
    recordPulse(midis, durationMs) {
      const cleanedMidis = sanitizeMidis(midis);
      if (!cleanedMidis.length) return;
      // If armed but measure hasn't started yet, buffer the note so it lands at step 0.
      if (recordState === "armed" && currentMeasureStartPerfMs === null) {
        const sourceId = `pulse-${pulseEventSeq++}`;
        const clampedDurationMs = Math.max(0, durationMs);
        preArmBuffer.set(sourceId, { midis: cleanedMidis, durationMs: clampedDurationMs });
        return;
      }
      if (!isRecordingOpen()) return;
      const sourceId = `pulse-${pulseEventSeq++}`;
      const clampedDurationMs = Math.max(0, durationMs);
      const now = performance.now();
      if (currentMeasureStartPerfMs === null) return;
      const startStep = getQuantizedStartStep(now);
      activeRecordedNotesBySource.set(sourceId, { midis: cleanedMidis, startStep });
      const timeoutId = window.setTimeout(() => {
        recordPulseTimeoutIds.delete(timeoutId);
        closeActiveRecordedSource(sourceId, now + clampedDurationMs);
      }, clampedDurationMs);
      recordPulseTimeoutIds.add(timeoutId);
    },
    recordHoldStart(sourceId, midis) {
      const cleanedMidis = sanitizeMidis(midis);
      if (!cleanedMidis.length) return;
      if (!sourceId.trim()) return;
      // If armed but measure hasn't started yet, buffer the hold at step 0.
      // durationMs: 0 marks it as an open hold — no auto-close at flush.
      if (recordState === "armed" && currentMeasureStartPerfMs === null) {
        preArmBuffer.set(sourceId, { midis: cleanedMidis, durationMs: 0 });
        return;
      }
      if (!isRecordingOpen()) return;
      if (currentMeasureStartPerfMs === null) return;
      const now = performance.now();
      closeActiveRecordedSource(sourceId, now);
      const startStep = getQuantizedStartStep(now);
      activeRecordedNotesBySource.set(sourceId, { midis: cleanedMidis, startStep });
    },
    recordHoldEnd(sourceId) {
      closeActiveRecordedSource(sourceId, performance.now());
    },
    // Coordinator API
    requestArm() {
      preArmBuffer.clear();
      if (loopMeasureCount === 0) {
        // No existing loop: start fresh.
        measureSlots.length = 0;
        nextWriteMeasureIndex = 0;
      } else {
        // Overwrite mode: keep existing slots; write starting at the seek target
        // (recordingSeekTarget survives count-in boundaries; fall back to playback position).
        // Clamp to 0 in case playbackMeasureIndex is still -1 from a previous
        // transport stop — writing to slot -1 would silently lose the recording.
        const fallback = Math.max(0, playbackMeasureIndex);
        nextWriteMeasureIndex = recordingSeekTarget ?? fallback;
        recordingSeekTarget = null;
      }
      recordedMeasuresInPass = 0;
      recordState = "armed";
      // Mark transport as playing so onBeatBoundary is processed when transport starts
      // (handles count-in path where requestArm fires before onTransportStart).
      isTransportPlaying = true;
      playbackMeasureIndex = -1;
      updateUi();
    },
    requestStop() {
      if (recordState === "recording") {
        recordState = "stopping";
        updateUi();
      }
    },
    getRecordState() {
      return recordState;
    },
    getLoopMeasureCount() {
      return loopMeasureCount;
    },
    seekToMeasure(index) {
      const clamped = clamp(index, 0, Math.max(0, (loopMeasureCount || 1) - 1));
      pendingSeekMeasure = clamped;
      // Also capture as a recording seek target so it survives count-in beat boundaries.
      recordingSeekTarget = clamped;
    },
    loadLoop(slots) {
      measureSlots.length = 0;
      for (const slot of slots) {
        measureSlots.push({
          events: slot.events.map((e) => ({ ...e, midis: [...e.midis] })),
        });
      }
      loopMeasureCount = measureSlots.length;
      updateUi();
    },
    getMeasureSlots() {
      return measureSlots.map((slot) => ({
        events: slot.events.map((e) => ({ ...e, midis: [...e.midis] })),
      }));
    },
    destroy() {
      recButton.removeEventListener("click", onControlButtonClick);
      clearTimeoutSet(playbackTimeoutIds);
      clearTimeoutSet(pulseEndTimeoutIds);
      clearTimeoutSet(recordPulseTimeoutIds);
      activeRecordedNotesBySource.clear();
      rootEl.remove();
    },
  };
}
