import { createCircleGuitarPlayer } from "../audio/circle-guitar-player.js";
import {
  createCircleOfFifthsUi,
  getCircleChordMidis,
  getCircleMajorChordMidis,
  type CircleChordSpec,
} from "../ui/circle-of-fifths.js";
import type { ModeDefinition } from "./types.js";

type CircleOfFifthsModeOptions = {
  onRandomnessChange?: (randomness: number | null) => void;
  onPulse?: () => void;
};

const CHORD_MODE_MIN_RANDOMNESS = 0.2;
const CHORD_MODE_MAX_RANDOMNESS = 0.75;
const CHORD_MODE_CYCLE_MS = 2000;
const CHORD_MODE_EXIT_DECAY_MS = 500;

export function createCircleOfFifthsMode(
  options: CircleOfFifthsModeOptions = {}
): ModeDefinition {
  const modeEl = document.querySelector<HTMLElement>(
    '.mode-screen[data-mode="circle-of-fifths"]'
  );
  const mountEl = modeEl?.querySelector<HTMLElement>("[data-circle-host]") ?? null;

  const guitarPlayer = createCircleGuitarPlayer();
  let circleUi: ReturnType<typeof createCircleOfFifthsUi> | null = null;
  let randomnessTimer: number | null = null;
  let chordModeActive = false;
  let chordModeRafId: number | null = null;
  let chordModeExitRafId: number | null = null;
  let chordModeStartTime = 0;

  const clearRandomnessTimeout = (): void => {
    if (randomnessTimer !== null) {
      window.clearTimeout(randomnessTimer);
      randomnessTimer = null;
    }
  };

  const stopChordModeAnimation = (): void => {
    if (chordModeRafId !== null) {
      window.cancelAnimationFrame(chordModeRafId);
      chordModeRafId = null;
    }
    if (chordModeExitRafId !== null) {
      window.cancelAnimationFrame(chordModeExitRafId);
      chordModeExitRafId = null;
    }
  };

  const startChordModeOscillation = (): void => {
    stopChordModeAnimation();
    chordModeStartTime = performance.now();

    const tick = (now: number): void => {
      if (!chordModeActive) {
        chordModeRafId = null;
        return;
      }
      const phase = ((now - chordModeStartTime) % CHORD_MODE_CYCLE_MS) / CHORD_MODE_CYCLE_MS;
      const swing = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
      const randomness =
        CHORD_MODE_MIN_RANDOMNESS +
        (CHORD_MODE_MAX_RANDOMNESS - CHORD_MODE_MIN_RANDOMNESS) * swing;
      options.onRandomnessChange?.(randomness);
      chordModeRafId = window.requestAnimationFrame(tick);
    };

    chordModeRafId = window.requestAnimationFrame(tick);
  };

  const easeOutToZero = (): void => {
    const startRandomness = CHORD_MODE_MIN_RANDOMNESS;
    const startTime = performance.now();
    stopChordModeAnimation();

    const tick = (now: number): void => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / CHORD_MODE_EXIT_DECAY_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      options.onRandomnessChange?.(startRandomness * (1 - eased));
      if (progress >= 1) {
        chordModeExitRafId = null;
        return;
      }
      chordModeExitRafId = window.requestAnimationFrame(tick);
    };

    chordModeExitRafId = window.requestAnimationFrame(tick);
  };

  const setChordMode = (next: boolean): void => {
    if (chordModeActive === next) return;
    chordModeActive = next;
    circleUi?.setChordMode(next);
    if (next) {
      startChordModeOscillation();
      return;
    }
    easeOutToZero();
  };

  const triggerPlaybackRandomness = (durationMs: number): void => {
    clearRandomnessTimeout();
    options.onRandomnessChange?.(0.75);
    randomnessTimer = window.setTimeout(() => {
      randomnessTimer = null;
      options.onRandomnessChange?.(0);
    }, durationMs);
  };

  const playChord = async (chord: CircleChordSpec): Promise<void> => {
    options.onPulse?.();
    triggerPlaybackRandomness(650);
    await guitarPlayer.playChord(getCircleChordMidis(chord), 640);
  };

  const playPrimary = async (midi: number): Promise<void> => {
    options.onPulse?.();
    await guitarPlayer.playMidi(midi, 400);
  };

  const playMajorChord = async (midi: number): Promise<void> => {
    options.onPulse?.();
    await guitarPlayer.playChord(getCircleMajorChordMidis(midi), 640);
  };

  return {
    id: "circle-of-fifths",
    title: "Circle of Fifths",
    icon: "CF",
    preserveState: false,
    canFullscreen: false,
    onEnter: () => {
      if (!mountEl) return;
      circleUi?.destroy();
      circleUi = createCircleOfFifthsUi(mountEl, {
        onPrimaryTap: (selection) => {
          setChordMode(true);
          void playPrimary(selection.primaryMidi);
        },
        onOuterTap: (note) => {
          if (!chordModeActive) return;
          void playMajorChord(note.midi);
        },
        onOuterDoubleTap: (note) => {
          if (!chordModeActive) return;
          setChordMode(false);
          circleUi?.setPrimaryByLabel(note.label);
        },
        onSecondaryTap: (chord) => {
          if (chordModeActive) return;
          void playChord(chord);
        },
      });
    },
    onExit: () => {
      clearRandomnessTimeout();
      stopChordModeAnimation();
      chordModeActive = false;
      options.onRandomnessChange?.(null);
      guitarPlayer.stopAll();
      circleUi?.destroy();
      circleUi = null;
    },
  };
}
