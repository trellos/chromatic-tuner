import type { ModeDefinition } from "./types.js";
import {
  getFretboardMidiAtPosition,
  getFretboardDots,
  getIntervals,
  normalizeChordType,
  type AnnotationType,
  type CharacteristicType,
  type DisplayType,
  type FretboardState,
  type NoteName,
  type ScaleType,
} from "./fretboard-logic.js";

const SCALE_OPTIONS: Array<{ value: ScaleType; label: string }> = [
  { value: "major", label: "Major" },
  { value: "minor", label: "Minor" },
  { value: "minor-pentatonic", label: "Minor Pentatonic" },
  { value: "major-pentatonic", label: "Major Pentatonic" },
  { value: "blues", label: "Blues" },
];

const CHORD_OPTIONS: Array<{ value: CharacteristicType; label: string }> = [
  { value: "major", label: "Major" },
  { value: "minor", label: "Minor" },
  { value: "power", label: "Power" },
  { value: "triad", label: "Triad" },
  { value: "seventh", label: "Seventh" },
  { value: "augmented", label: "Augmented" },
  { value: "suspended-second", label: "Suspended Second" },
  { value: "suspended-fourth", label: "Suspended Fourth" },
  { value: "ninth", label: "Ninth" },
];

const DEFAULT_STATE: FretboardState = {
  root: "C",
  display: "scale",
  characteristic: "major",
  annotation: "notes",
};
const GUITAR_SAMPLE_URL = "assets/audio/fretboard/guitar-acoustic-c4.mp3";
const GUITAR_SAMPLE_BASE_MIDI = 60;
const FRETBOARD_NOTE_GAIN = 0.84;
const PLAY_CHORD_DURATION_MS = 1000;
const PLAY_SCALE_STEP_MS = 180;
const PLAY_SCALE_NOTE_DURATION_MS = 160;
const PLAY_RANDOMNESS_PEAK = 0.8;

const NOTE_TO_SEMITONE: Record<NoteName, number> = {
  A: 9,
  "A#": 10,
  B: 11,
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
};

type FretboardModeOptions = {
  onRandomnessChange?: (randomness: number | null) => void;
};

export function createFretboardMode(options: FretboardModeOptions = {}): ModeDefinition {
  const modeEl = document.querySelector<HTMLElement>('.mode-screen[data-mode="fretboard"]');
  const rootButtons = modeEl?.querySelectorAll<HTMLButtonElement>('[data-fretboard-root]') ?? [];
  const displayButtons = modeEl?.querySelectorAll<HTMLButtonElement>('[data-fretboard-display]') ?? [];
  const characteristicSelect = modeEl?.querySelector<HTMLSelectElement>('#fretboard-characteristic') ?? null;
  const annotationButtons = modeEl?.querySelectorAll<HTMLButtonElement>('[data-fretboard-annotation]') ?? [];
  const dotsLayer = modeEl?.querySelector<HTMLElement>('.fretboard-dots') ?? null;
  const openIndicatorsLayer =
    modeEl?.querySelector<HTMLElement>('.fretboard-open-indicators') ?? null;
  const playButton = modeEl?.querySelector<HTMLButtonElement>("[data-fretboard-play]") ?? null;

  let state: FretboardState = { ...DEFAULT_STATE };
  let uiAbort: AbortController | null = null;
  let audioContext: AudioContext | null = null;
  let guitarSampleBuffer: AudioBuffer | null = null;
  let guitarSampleLoadPromise: Promise<AudioBuffer | null> | null = null;
  let playEndTimer: number | null = null;
  let playRandomnessRaf: number | null = null;
  const activeSources = new Set<AudioScheduledSourceNode>();

  const getAudioContextCtor = ():
    | (typeof AudioContext)
    | (new (contextOptions?: AudioContextOptions) => AudioContext)
    | null => {
    return window.AudioContext ?? ((window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null);
  };

  const ensureAudioContext = async (): Promise<AudioContext | null> => {
    if (audioContext && audioContext.state !== "closed") {
      await audioContext.resume();
      return audioContext;
    }
    const AudioCtx = getAudioContextCtor();
    if (!AudioCtx) return null;
    audioContext = new AudioCtx({ latencyHint: "interactive" });
    await audioContext.resume();
    return audioContext;
  };

  const ensureGuitarSample = async (ctx: AudioContext): Promise<AudioBuffer | null> => {
    if (guitarSampleBuffer) return guitarSampleBuffer;
    if (guitarSampleLoadPromise) {
      return guitarSampleLoadPromise;
    }
    guitarSampleLoadPromise = (async () => {
      try {
        const response = await fetch(GUITAR_SAMPLE_URL);
        if (!response.ok) return null;
        const arrayBuffer = await response.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        guitarSampleBuffer = decoded;
        return decoded;
      } catch {
        return null;
      } finally {
        guitarSampleLoadPromise = null;
      }
    })();
    return guitarSampleLoadPromise;
  };

  const setPlayButtonState = (playing: boolean): void => {
    if (!playButton) return;
    playButton.classList.toggle("is-playing", playing);
    playButton.textContent = playing ? "Playing..." : "Play";
  };

  const clearPlayEndTimer = (): void => {
    if (playEndTimer === null) return;
    window.clearTimeout(playEndTimer);
    playEndTimer = null;
  };

  const stopRandomnessRamp = (emitFinalZero: boolean): void => {
    if (playRandomnessRaf !== null) {
      cancelAnimationFrame(playRandomnessRaf);
      playRandomnessRaf = null;
    }
    if (emitFinalZero) {
      options.onRandomnessChange?.(0);
    }
  };

  const startRandomnessRamp = (durationMs: number): void => {
    stopRandomnessRamp(false);
    const safeDuration = Math.max(1, durationMs);
    const start = performance.now();
    options.onRandomnessChange?.(PLAY_RANDOMNESS_PEAK);

    const tick = (now: number): void => {
      const t = Math.min(1, Math.max(0, (now - start) / safeDuration));
      const next = PLAY_RANDOMNESS_PEAK * (1 - t);
      options.onRandomnessChange?.(next);
      if (t >= 1) {
        playRandomnessRaf = null;
        options.onRandomnessChange?.(0);
        return;
      }
      playRandomnessRaf = requestAnimationFrame(tick);
    };

    playRandomnessRaf = requestAnimationFrame(tick);
  };

  const unregisterSource = (source: AudioScheduledSourceNode): void => {
    activeSources.delete(source);
  };

  const registerSource = (source: AudioScheduledSourceNode): void => {
    activeSources.add(source);
    source.addEventListener("ended", () => unregisterSource(source), { once: true });
  };

  const stopActiveSources = (): void => {
    activeSources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Ignore stop errors for already-ended nodes.
      }
    });
    activeSources.clear();
  };

  const playFallbackToneAt = (
    ctx: AudioContext,
    midi: number,
    startTimeSec: number,
    durationMs: number
  ): void => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const freqHz = 440 * Math.pow(2, (midi - 69) / 12);
    const durationSec = Math.max(0.02, durationMs / 1000);
    osc.type = "triangle";
    osc.frequency.value = freqHz;
    gain.gain.setValueAtTime(0.0001, startTimeSec);
    gain.gain.exponentialRampToValueAtTime(0.22, startTimeSec + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTimeSec + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    registerSource(osc);
    osc.start(startTimeSec);
    osc.stop(startTimeSec + durationSec + 0.01);
  };

  const playSampleAt = (
    ctx: AudioContext,
    sample: AudioBuffer,
    midi: number,
    startTimeSec: number,
    durationMs: number
  ): void => {
    const source = ctx.createBufferSource();
    source.buffer = sample;
    source.playbackRate.value = Math.pow(2, (midi - GUITAR_SAMPLE_BASE_MIDI) / 12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(FRETBOARD_NOTE_GAIN, startTimeSec);
    source.connect(gain);
    gain.connect(ctx.destination);
    registerSource(source);
    source.start(startTimeSec);
    if (durationMs > 0) {
      source.stop(startTimeSec + durationMs / 1000);
    }
  };

  const playMidiAt = (
    ctx: AudioContext,
    sample: AudioBuffer | null,
    midi: number,
    startTimeSec: number,
    durationMs: number
  ): void => {
    if (sample) {
      playSampleAt(ctx, sample, midi, startTimeSec, durationMs);
      return;
    }
    playFallbackToneAt(ctx, midi, startTimeSec, durationMs);
  };

  const playDotMidi = async (midi: number): Promise<void> => {
    const ctx = await ensureAudioContext();
    if (!ctx) return;
    const sample = await ensureGuitarSample(ctx);
    playMidiAt(ctx, sample, midi, ctx.currentTime + 0.01, 360);
  };

  const clearScheduledPlayback = (emitFinalZero: boolean): void => {
    clearPlayEndTimer();
    stopRandomnessRamp(emitFinalZero);
    stopActiveSources();
    setPlayButtonState(false);
  };

  const playCurrentPattern = async (): Promise<void> => {
    const intervals = [...new Set(getIntervals(state.display, state.characteristic))]
      .map((interval) => ((interval % 12) + 12) % 12)
      .sort((a, b) => a - b);
    if (intervals.length === 0) return;

    const rootSemitone = NOTE_TO_SEMITONE[state.root] ?? 0;
    const rootMidi = GUITAR_SAMPLE_BASE_MIDI + rootSemitone;

    const ctx = await ensureAudioContext();
    if (!ctx) return;
    const sample = await ensureGuitarSample(ctx);

    clearScheduledPlayback(false);
    setPlayButtonState(true);

    let totalDurationMs = PLAY_CHORD_DURATION_MS;
    const startTimeSec = ctx.currentTime + 0.02;
    if (state.display === "scale") {
      const scaleMidis = intervals.map((interval) => rootMidi + interval);
      scaleMidis.push(rootMidi + 12);
      scaleMidis.forEach((midi, index) => {
        const at = startTimeSec + (index * PLAY_SCALE_STEP_MS) / 1000;
        playMidiAt(ctx, sample, midi, at, PLAY_SCALE_NOTE_DURATION_MS);
      });
      totalDurationMs =
        PLAY_SCALE_NOTE_DURATION_MS + PLAY_SCALE_STEP_MS * Math.max(0, scaleMidis.length - 1);
    } else {
      intervals.forEach((interval) => {
        playMidiAt(ctx, sample, rootMidi + interval, startTimeSec, PLAY_CHORD_DURATION_MS);
      });
      totalDurationMs = PLAY_CHORD_DURATION_MS;
    }

    startRandomnessRamp(totalDurationMs);
    playEndTimer = window.setTimeout(() => {
      playEndTimer = null;
      stopActiveSources();
      setPlayButtonState(false);
      options.onRandomnessChange?.(0);
    }, totalDurationMs + 60);
  };

  const setCharacteristicOptions = () => {
    if (!characteristicSelect) return;
    const options = state.display === "scale" ? SCALE_OPTIONS : CHORD_OPTIONS;
    const previous = String(state.characteristic);

    characteristicSelect.innerHTML = "";
    for (const option of options) {
      const next = document.createElement("option");
      next.value = option.value;
      next.textContent = option.label;
      characteristicSelect.append(next);
    }

    const hasPrevious = options.some((option) => option.value === previous);
    const fallback = options[0]?.value ?? "minor";
    state.characteristic = hasPrevious ? (previous as CharacteristicType) : fallback;
    characteristicSelect.value = state.characteristic;
  };

  const renderControls = () => {
    rootButtons.forEach((button) => {
      const isActive = button.dataset.fretboardRoot === state.root;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    displayButtons.forEach((button) => {
      const isActive = button.dataset.fretboardDisplay === state.display;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    annotationButtons.forEach((button) => {
      const isActive = button.dataset.fretboardAnnotation === state.annotation;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  };

  const renderDots = () => {
    if (!dotsLayer || !openIndicatorsLayer) return;
    const dots = getFretboardDots(state);
    dotsLayer.innerHTML = "";
    openIndicatorsLayer.innerHTML = "";

    for (const dot of dots) {
      const isRoot = dot.degree === "1";
      if (dot.fret === 0) {
        const openIndicator = document.createElement("span");
        openIndicator.className = "fretboard-open-indicator";
        openIndicator.classList.toggle("is-root", isRoot);
        openIndicator.style.setProperty("--string-index", String(dot.stringIndex));
        openIndicator.dataset.root = isRoot ? "1" : "0";
        openIndicator.dataset.note = dot.note;
        openIndicator.dataset.degree = dot.degree;
        openIndicator.dataset.midi = String(dot.midi ?? getFretboardMidiAtPosition(dot.stringIndex, dot.fret));
        openIndicatorsLayer.append(openIndicator);
        continue;
      }

      const marker = document.createElement("span");
      marker.className = "fretboard-dot";
      marker.classList.toggle("is-root", isRoot);
      marker.style.setProperty("--string-index", String(dot.stringIndex));
      marker.style.setProperty("--fret-index", String(dot.fret));
      marker.dataset.note = dot.note;
      marker.dataset.degree = dot.degree;
      marker.dataset.fret = String(dot.fret);
      marker.dataset.root = isRoot ? "1" : "0";
      marker.dataset.midi = String(dot.midi ?? getFretboardMidiAtPosition(dot.stringIndex, dot.fret));
      marker.textContent = state.annotation === "notes" ? dot.note : dot.degree;
      dotsLayer.append(marker);
    }
  };

  const render = () => {
    setCharacteristicOptions();
    renderControls();
    renderDots();
  };

  const enterMode = () => {
    if (!modeEl || uiAbort) return;
    uiAbort = new AbortController();
    const signal = uiAbort.signal;
    setPlayButtonState(false);

    rootButtons.forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const root = button.dataset.fretboardRoot;
          if (!root) return;
          state.root = root as FretboardState["root"];
          render();
        },
        { signal }
      );
    });

    displayButtons.forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const nextDisplay = button.dataset.fretboardDisplay as DisplayType | undefined;
          if (!nextDisplay || nextDisplay === state.display) return;
          state.display = nextDisplay;
          render();
        },
        { signal }
      );
    });

    characteristicSelect?.addEventListener(
      "change",
      () => {
        const nextRaw = characteristicSelect.value;
        if (state.display === "chord") {
          state.characteristic = normalizeChordType(nextRaw) ?? "major";
        } else {
          state.characteristic = (nextRaw as ScaleType) ?? "minor";
        }
        render();
      },
      { signal }
    );

    annotationButtons.forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const annotation = button.dataset.fretboardAnnotation as AnnotationType | undefined;
          if (!annotation) return;
          state.annotation = annotation;
          renderControls();
          renderDots();
        },
        { signal }
      );
    });

    playButton?.addEventListener(
      "click",
      () => {
        void playCurrentPattern();
      },
      { signal }
    );

    dotsLayer?.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        const marker = target?.closest<HTMLElement>(".fretboard-dot");
        if (!marker) return;
        const midi = Number.parseInt(marker.dataset.midi ?? "", 10);
        if (!Number.isFinite(midi)) return;
        void playDotMidi(midi);
      },
      { signal }
    );

    openIndicatorsLayer?.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        const marker = target?.closest<HTMLElement>(".fretboard-open-indicator");
        if (!marker) return;
        const midi = Number.parseInt(marker.dataset.midi ?? "", 10);
        if (!Number.isFinite(midi)) return;
        void playDotMidi(midi);
      },
      { signal }
    );

    render();
  };

  const exitMode = () => {
    uiAbort?.abort();
    uiAbort = null;
    clearScheduledPlayback(false);
    options.onRandomnessChange?.(null);
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close();
    }
    audioContext = null;
    guitarSampleBuffer = null;
    guitarSampleLoadPromise = null;
  };

  return {
    id: "fretboard",
    title: "Fretboard",
    icon: "FB",
    preserveState: true,
    onEnter: enterMode,
    onExit: exitMode,
  };
}
