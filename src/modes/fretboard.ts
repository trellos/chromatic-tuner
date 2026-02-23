import { createFretboardUi } from "../ui/fretboard.js";
import type { ModeDefinition } from "./types.js";
import {
  getChordTapPlaybackTargets,
  getKeyTapPlaybackTargets,
  getIntervals,
  type CharacteristicType,
  type FretboardPlaybackTarget,
  type FretboardState,
  type NoteName,
} from "./fretboard-logic.js";

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
let cachedGuitarSampleBytes: ArrayBuffer | null = null;
let cachedGuitarSampleBuffer: AudioBuffer | null = null;
let cachedGuitarSampleFetchPromise: Promise<ArrayBuffer | null> | null = null;
let cachedGuitarSampleDecodePromise: Promise<AudioBuffer | null> | null = null;

async function fetchGuitarSampleBytes(): Promise<ArrayBuffer | null> {
  if (cachedGuitarSampleBytes) return cachedGuitarSampleBytes;
  if (cachedGuitarSampleFetchPromise) return cachedGuitarSampleFetchPromise;
  cachedGuitarSampleFetchPromise = (async () => {
    try {
      const response = await fetch(GUITAR_SAMPLE_URL);
      if (!response.ok) return null;
      const bytes = await response.arrayBuffer();
      cachedGuitarSampleBytes = bytes;
      return bytes;
    } catch {
      return null;
    } finally {
      cachedGuitarSampleFetchPromise = null;
    }
  })();
  return cachedGuitarSampleFetchPromise;
}

export function preloadFretboardAudioAssets(): void {
  void fetchGuitarSampleBytes();
}

type FretboardModeOptions = {
  onRandomnessChange?: (randomness: number | null) => void;
};

export function createFretboardMode(options: FretboardModeOptions = {}): ModeDefinition {
  const modeEl = document.querySelector<HTMLElement>('.mode-screen[data-mode="fretboard"]');
  const ui = modeEl
    ? createFretboardUi(modeEl, {
        initialState: DEFAULT_STATE,
        showControls: true,
        onStateChange: (nextState) => {
          state = nextState;
        },
        onPlayPress: () => {
          void playCurrentPattern();
        },
        onFretPress: ({ midi, stringIndex, fret }) => {
          if (state.display === "chord") {
            const chordTargets = getChordTapPlaybackTargets({
              chordRoot: state.root,
              characteristic: state.characteristic,
              tappedMidi: midi,
              tappedStringIndex: stringIndex,
            });
            void playTargets(chordTargets, 520);
            return;
          }
          if (state.display === "key") {
            const keyTargets = getKeyTapPlaybackTargets({
              keyRoot: state.root,
              keyMode: state.characteristic,
              tappedMidi: midi,
              tappedStringIndex: stringIndex,
            });
            void playTargets(keyTargets, 560);
            return;
          }
          void playTargets([{ midi, stringIndex, isRoot: fret === 0 }], 360);
        },
      })
    : null;

  let state: FretboardState = { ...DEFAULT_STATE };
  let audioContext: AudioContext | null = null;
  let guitarSampleBuffer: AudioBuffer | null = null;
  let guitarSampleLoadPromise: Promise<AudioBuffer | null> | null = null;
  let playEndTimer: number | null = null;
  let playRandomnessRaf: number | null = null;
  const visualPulseTimers = new Set<number>();
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
    if (cachedGuitarSampleBuffer) {
      guitarSampleBuffer = cachedGuitarSampleBuffer;
      return guitarSampleBuffer;
    }
    if (guitarSampleLoadPromise) {
      return guitarSampleLoadPromise;
    }
    guitarSampleLoadPromise = (async () => {
      try {
        const bytes = await fetchGuitarSampleBytes();
        if (!bytes) return null;
        if (cachedGuitarSampleBuffer) {
          guitarSampleBuffer = cachedGuitarSampleBuffer;
          return guitarSampleBuffer;
        }
        if (!cachedGuitarSampleDecodePromise) {
          cachedGuitarSampleDecodePromise = (async () => {
            try {
              const decoded = await ctx.decodeAudioData(bytes.slice(0));
              cachedGuitarSampleBuffer = decoded;
              return decoded;
            } catch {
              return null;
            } finally {
              cachedGuitarSampleDecodePromise = null;
            }
          })();
        }
        const decoded = await cachedGuitarSampleDecodePromise;
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
    const playButton = modeEl?.querySelector<HTMLButtonElement>("[data-fretboard-play]");
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

  const registerSource = (source: AudioScheduledSourceNode): void => {
    activeSources.add(source);
    source.addEventListener(
      "ended",
      () => {
        activeSources.delete(source);
      },
      { once: true }
    );
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

  const clearVisualPulseTimers = (): void => {
    visualPulseTimers.forEach((timerId) => window.clearTimeout(timerId));
    visualPulseTimers.clear();
  };

  const scheduleVisualPulse = (
    targets: FretboardPlaybackTarget[],
    delayMs: number,
    durationMs: number
  ): void => {
    const timerId = window.setTimeout(() => {
      visualPulseTimers.delete(timerId);
      ui?.pulseTargets(targets, durationMs);
    }, Math.max(0, delayMs));
    visualPulseTimers.add(timerId);
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

  const playTargets = async (targets: FretboardPlaybackTarget[], durationMs: number): Promise<void> => {
    if (!targets.length) return;
    const ctx = await ensureAudioContext();
    if (!ctx) return;
    const sample = await ensureGuitarSample(ctx);
    const startTimeSec = ctx.currentTime + 0.01;
    targets.forEach((target) => playMidiAt(ctx, sample, target.midi, startTimeSec, durationMs));
    ui?.pulseTargets(targets, durationMs);
  };

  const clearScheduledPlayback = (emitFinalZero: boolean): void => {
    clearPlayEndTimer();
    stopRandomnessRamp(emitFinalZero);
    clearVisualPulseTimers();
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
    if (state.display !== "chord") {
      const scaleMidis = intervals.map((interval) => rootMidi + interval);
      scaleMidis.push(rootMidi + 12);
      scaleMidis.forEach((midi, index) => {
        const at = startTimeSec + (index * PLAY_SCALE_STEP_MS) / 1000;
        playMidiAt(ctx, sample, midi, at, PLAY_SCALE_NOTE_DURATION_MS);
        const semitone = ((midi % 12) + 12) % 12;
        const isRoot = semitone === rootSemitone;
        const pulseTarget: FretboardPlaybackTarget = {
          midi,
          stringIndex: 0,
          isRoot,
        };
        scheduleVisualPulse([pulseTarget], index * PLAY_SCALE_STEP_MS, PLAY_SCALE_NOTE_DURATION_MS);
      });
      totalDurationMs =
        PLAY_SCALE_NOTE_DURATION_MS + PLAY_SCALE_STEP_MS * Math.max(0, scaleMidis.length - 1);
    } else {
      const chordTargets = intervals.map((interval, index): FretboardPlaybackTarget => ({
        midi: rootMidi + interval,
        stringIndex: index,
        isRoot: interval === 0,
      }));
      chordTargets.forEach((target) => {
        playMidiAt(ctx, sample, target.midi, startTimeSec, PLAY_CHORD_DURATION_MS);
      });
      scheduleVisualPulse(chordTargets, 0, PLAY_CHORD_DURATION_MS);
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

  const enterMode = () => {
    if (!modeEl) return;
    setPlayButtonState(false);
    state = { ...state };
    ui?.render(state);
    ui?.enter();
  };

  const exitMode = () => {
    ui?.exit();
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
