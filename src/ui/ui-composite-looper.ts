import type { LooperRecorder } from "./looper-recordable.js";
import { clamp } from "../utils.js";

const STEPS_PER_MEASURE = 16;
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
  onPlaybackEvent: (event: {
    measureIndex: number;
    midis: number[];
    durationMs: number;
  }) => void;
  /** Called when the REC button is pressed while idle, before arming. Coordinator uses this to stop other loopers. */
  onRecButtonPressed?: () => void;
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
  recButton.textContent = "REC";
  recButton.setAttribute("aria-label", "Record loop");
  recButton.dataset.looperRec = "1";
  controlRow.appendChild(recButton);

  const playButton = document.createElement("button");
  playButton.className = "ui-composite-looper-btn ui-composite-looper-btn--play";
  playButton.type = "button";
  playButton.textContent = "PLAY";
  playButton.setAttribute("aria-label", "Play loop");
  playButton.dataset.looperPlay = "1";
  controlRow.appendChild(playButton);

  const measureSlots: MeasureSlot[] = [];
  const activeRecordedNotesBySource = new Map<string, ActiveRecordedNote>();
  const playbackTimeoutIds = new Set<number>();
  const pulseEndTimeoutIds = new Set<number>();
  const recordPulseTimeoutIds = new Set<number>();

  let loopMeasureCount = 0;
  let recordState: LooperRecordState = "idle";
  let isTransportPlaying = false;
  let sawFirstMeasureBoundary = false;
  let playbackMeasureIndex = 0;
  let nextWriteMeasureIndex = 0;
  let recordingMeasureIndex: number | null = null;
  let recordedMeasuresInPass = 0;
  let currentRecordingEvents: QuantizedNoteEvent[] = [];
  let currentMeasureStartPerfMs: number | null = null;
  let currentMeasureDurationMs = SAFE_MEASURE_DURATION_MS;
  let pulseEventSeq = 0;
  let pendingSeekMeasure: number | null = null;


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
    return clamp(Math.floor(ratio * STEPS_PER_MEASURE), 0, STEPS_PER_MEASURE - 1);
  };

  const getQuantizedEndStep = (eventPerfMs: number, startStep: number): number => {
    if (currentMeasureStartPerfMs === null) {
      return clamp(startStep + MIN_EVENT_STEPS, 1, STEPS_PER_MEASURE);
    }
    const ratio = (eventPerfMs - currentMeasureStartPerfMs) / Math.max(1, currentMeasureDurationMs);
    const rawEnd = Math.ceil(ratio * STEPS_PER_MEASURE);
    const minEnd = startStep + MIN_EVENT_STEPS;
    return clamp(rawEnd, minEnd, STEPS_PER_MEASURE);
  };

  const pushQuantizedEvent = (midis: number[], startStep: number, endStep: number): void => {
    const cleanedMidis = sanitizeMidis(midis);
    if (!cleanedMidis.length) return;
    const normalizedStart = clamp(startStep, 0, STEPS_PER_MEASURE - 1);
    const normalizedEnd = clamp(
      endStep,
      normalizedStart + MIN_EVENT_STEPS,
      STEPS_PER_MEASURE
    );
    if (normalizedEnd <= normalizedStart) return;
    currentRecordingEvents.push({
      midis: cleanedMidis,
      startStep: normalizedStart,
      endStep: normalizedEnd,
    });
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
      pushQuantizedEvent(active.midis, active.startStep, STEPS_PER_MEASURE);
      active.startStep = 0;
    });
  };

  const finalizeRecordedMeasure = (): void => {
    if (recordingMeasureIndex === null) return;
    closeAllActiveNotesAtMeasureEnd();
    const finalizedEvents = currentRecordingEvents
      .map((event) => ({ ...event, midis: [...event.midis] }))
      .sort((left, right) => left.startStep - right.startStep);
    measureSlots.push({ events: finalizedEvents });
    currentRecordingEvents = [];
    recordedMeasuresInPass += 1;
    nextWriteMeasureIndex = measureSlots.length;
    if (recordedMeasuresInPass >= MAX_MEASURES && recordState === "recording") {
      recordState = "stopping";
    }
  };

  const stopRecordingAtBoundary = (): void => {
    loopMeasureCount = measureSlots.length;
    recordState = "idle";
    recordingMeasureIndex = null;
    recordedMeasuresInPass = 0;
    activeRecordedNotesBySource.clear();
    currentRecordingEvents = [];
  };

  const startRecordingMeasure = (measureIndex: number): void => {
    recordingMeasureIndex = measureIndex;
    currentRecordingEvents = [];
    activeRecordedNotesBySource.clear();
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
    const stepDurationMs = currentMeasureDurationMs / STEPS_PER_MEASURE;
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
    rootEl.classList.toggle(
      "is-play-mode",
      recordState === "idle" && hasRecording && isTransportPlaying
    );
    rootEl.classList.toggle("is-rec-active", recordState !== "idle");
    rootEl.dataset.looperState = recordState;
    recButton.setAttribute("aria-pressed", String(recordState !== "idle"));
    recButton.setAttribute("aria-label", recordState === "idle" ? "Record loop" : "Recording control");
    recButton.disabled = false;
    playButton.setAttribute(
      "aria-pressed",
      String(recordState === "idle" && hasRecording && isTransportPlaying)
    );
    playButton.disabled = !hasRecording;

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
    if (!sawFirstMeasureBoundary) {
      playbackMeasureIndex = 0;
      sawFirstMeasureBoundary = true;
    } else {
      if (pendingSeekMeasure !== null) {
        playbackMeasureIndex = pendingSeekMeasure;
        pendingSeekMeasure = null;
      } else {
        const effectiveCount = loopMeasureCount > 0 ? loopMeasureCount : 1;
        playbackMeasureIndex = (playbackMeasureIndex + 1) % effectiveCount;
      }
    }

    if (recordState === "recording" || recordState === "stopping") {
      finalizeRecordedMeasure();
    }

    if (recordState === "stopping") {
      stopRecordingAtBoundary();
    } else if (recordState === "armed") {
      startRecordingMeasure(nextWriteMeasureIndex);
    } else if (recordState === "recording") {
      startRecordingMeasure(nextWriteMeasureIndex);
    }

    schedulePlaybackForMeasure(playbackMeasureIndex, measureStartPerfMs);
    updateUi();
  };

  recButton.addEventListener("click", onControlButtonClick);
  playButton.addEventListener("click", onControlButtonClick);
  updateUi();

  return {
    rootEl,
    onTransportStart() {
      isTransportPlaying = true;
      sawFirstMeasureBoundary = false;
      playbackMeasureIndex = 0;
      currentMeasureStartPerfMs = null;
      currentMeasureDurationMs = readMeasureDurationMs();
      updateUi();
    },
    onTransportStop() {
      isTransportPlaying = false;
      sawFirstMeasureBoundary = false;
      playbackMeasureIndex = 0;
      currentMeasureStartPerfMs = null;
      clearTimeoutSet(playbackTimeoutIds);
      clearTimeoutSet(recordPulseTimeoutIds);
      if (isRecordingOpen()) {
        activeRecordedNotesBySource.clear();
        currentRecordingEvents = [];
        recordState = "idle";
        recordingMeasureIndex = null;
        recordedMeasuresInPass = 0;
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
      if (!isRecordingOpen()) return;
      const sourceId = `pulse-${pulseEventSeq++}`;
      const clampedDurationMs = Math.max(0, durationMs);
      const now = performance.now();
      const cleanedMidis = sanitizeMidis(midis);
      if (!cleanedMidis.length) return;
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
      if (!isRecordingOpen()) return;
      if (!sourceId.trim()) return;
      const cleanedMidis = sanitizeMidis(midis);
      if (!cleanedMidis.length) return;
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
      measureSlots.length = 0;
      loopMeasureCount = 0;
      nextWriteMeasureIndex = 0;
      recordedMeasuresInPass = 0;
      recordState = "armed";
      // Mark transport as playing so onBeatBoundary is processed when transport starts
      // (handles count-in path where requestArm fires before onTransportStart).
      isTransportPlaying = true;
      sawFirstMeasureBoundary = false;
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
      pendingSeekMeasure = clamp(index, 0, Math.max(0, (loopMeasureCount || 1) - 1));
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
      playButton.removeEventListener("click", onControlButtonClick);
      clearTimeoutSet(playbackTimeoutIds);
      clearTimeoutSet(pulseEndTimeoutIds);
      clearTimeoutSet(recordPulseTimeoutIds);
      activeRecordedNotesBySource.clear();
      rootEl.remove();
    },
  };
}
