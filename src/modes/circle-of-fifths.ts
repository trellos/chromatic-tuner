import { createCircleGuitarPlayer } from "../audio/circle-guitar-player.js";
import { seigaihaBridge } from "../app/seigaiha-bridge.js";
import {
  createCircleOfFifthsUi,
  getCircleChordMidis,
  getCircleMajorChordMidis,
  type CircleChordSpec,
  type CircleChordModeOptions,
} from "../ui/circle-of-fifths.js";
import type { ModeDefinition } from "./types.js";

const CHORD_MODE_MIN_RANDOMNESS = 0.2;
const CHORD_MODE_MAX_RANDOMNESS = 0.75;
const CHORD_MODE_CYCLE_MS = 2000;
const CHORD_MODE_EXIT_DECAY_MS = 500;
const TAP_PLAYBACK_DEBOUNCE_MS = 440;

export function createCircleOfFifthsMode(): ModeDefinition {
  const options = {
    onRandomnessChange: (r: number | null) => seigaihaBridge.setModeRandomness(r),
    onPulse: () => seigaihaBridge.pulse(),
  };
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
  let lastPrimaryLabel: string | null = null;
  let suppressNextTapPlayback = false;
  let lastTapPlaybackAt = 0;
  let lastTapPlaybackSignature = "";

  const shouldSuppressTapPlayback = (): boolean => {
    if (!suppressNextTapPlayback) return false;
    suppressNextTapPlayback = false;
    return true;
  };

  const shouldDebounceTapPlayback = (signature: string): boolean => {
    const now = performance.now();
    if (signature === lastTapPlaybackSignature && now - lastTapPlaybackAt < TAP_PLAYBACK_DEBOUNCE_MS) {
      return true;
    }
    lastTapPlaybackAt = now;
    lastTapPlaybackSignature = signature;
    return false;
  };

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

  const setChordMode = (next: boolean, modeOptions: CircleChordModeOptions = {}): void => {
    // Chord mode has two coupled effects:
    // 1) UI mode switch (outer taps become major-triad playback)
    // 2) background randomness animation (oscillate while active, ease out on exit)
    if (chordModeActive === next) {
      circleUi?.setChordMode(next, modeOptions);
      return;
    }
    chordModeActive = next;
    circleUi?.setChordMode(next, modeOptions);
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
    const chordMidis = getCircleChordMidis(chord);
    circleUi?.pulseChord(chordMidis, 640);
    await guitarPlayer.playChord(chordMidis, 640);
  };

  const playPrimary = async (midi: number): Promise<void> => {
    circleUi?.pulseNote(midi, 400);
    await guitarPlayer.playMidi(midi, 400);
  };

  const playMajorChord = async (midi: number): Promise<void> => {
    const chordMidis = getCircleMajorChordMidis(midi);
    circleUi?.pulseChord(chordMidis, 640);
    await guitarPlayer.playChord(chordMidis, 640);
  };

  return {
    id: "circle-of-fifths",
    title: "Circle of Fifths",
    icon: "CF",
    preserveState: false,
    canFullscreen: false,
    onEnter: () => {
      // Recreate UI each entry to avoid stale listeners/state between mode switches.
      if (!mountEl) return;
      lastPrimaryLabel = null;
      suppressNextTapPlayback = false;
      lastTapPlaybackAt = 0;
      lastTapPlaybackSignature = "";
      circleUi?.destroy();
      const initialInstrumentName = guitarPlayer.setInstrument("guitar-acoustic");
      circleUi = createCircleOfFifthsUi(mountEl, {
        // UI -> mode callback usage:
        // - interaction callbacks map to playback/state transitions.
        // - background callbacks are the only path for mode-owned Seigaiha updates.
        // - UI DOM state changes are performed through returned Circle UI methods.
        onBackgroundPulseRequest: () => {
          options.onPulse?.();
        },
        onBackgroundRandomnessRequest: (randomness) => {
          const clamped = Math.min(1, Math.max(0, randomness));
          triggerPlaybackRandomness(clamped >= 0.75 ? 650 : 420);
        },
        onChordModeChange: (enabled) => {
          // The UI self-manages chord mode entry (retap detection); sync mode state here.
          if (chordModeActive === enabled) return;
          chordModeActive = enabled;
          if (enabled) {
            startChordModeOscillation();
          } else {
            easeOutToZero();
          }
        },
        onPrimaryTap: (selection) => {
          // Tap flow:
          // - first tap on a primary: select + single-note playback
          // - retap same primary: UI enters chord mode (onChordModeChange fires first), play major triad
          const isPrimaryRetap = selection.primaryLabel === lastPrimaryLabel;
          lastPrimaryLabel = selection.primaryLabel;
          const skipPlayback = shouldSuppressTapPlayback();
          if (isPrimaryRetap) {
            if (!skipPlayback) {
              if (shouldDebounceTapPlayback(`maj:${selection.primaryMidi}`)) return;
              void playMajorChord(selection.primaryMidi);
            }
          } else {
            setChordMode(false);
            if (!skipPlayback) {
              if (shouldDebounceTapPlayback(`note:${selection.primaryMidi}`)) return;
              void playPrimary(selection.primaryMidi);
            }
          }
        },
        onOuterTap: (note) => {
          if (!chordModeActive) return;
          if (shouldSuppressTapPlayback()) return;
          if (shouldDebounceTapPlayback(`maj:${note.midi}`)) return;
          void playMajorChord(note.midi);
        },
        onBackgroundTap: () => {
          guitarPlayer.stopSustain();
        },
        onOuterDoubleTap: (note) => {
          if (!chordModeActive || !note.isPrimary) return;
          setChordMode(true, { zoomToPrimary: true });
        },
        onInnerDoubleTap: () => {
          const instrumentName = guitarPlayer.cycleInstrument();
          circleUi?.setInstrumentLabel(instrumentName);
          circleUi?.showInnerIndicator(instrumentName);
        },
        onSecondaryTap: (chord) => {
          if (shouldSuppressTapPlayback()) return;
          if (shouldDebounceTapPlayback(`sec:${chord.label}`)) return;
          void playChord(chord);
        },
        onNoteBarTap: (note) => {
          suppressNextTapPlayback = false;
          void playPrimary(note.midi);
        },
        onNoteBarPressStart: (note) => {
          suppressNextTapPlayback = true;
          circleUi?.holdNote(note.midi);
          void guitarPlayer.startSustainMidi(note.midi);
        },
        onNoteBarPressEnd: () => {
          circleUi?.releaseHeldNotes();
          guitarPlayer.stopSustain();
        },
        onOuterPressStart: (note) => {
          suppressNextTapPlayback = true;
          if (chordModeActive) {
            const chordMidis = getCircleMajorChordMidis(note.midi);
            circleUi?.holdChord(chordMidis);
            void guitarPlayer.startSustainChord(chordMidis);
            return;
          }
          circleUi?.holdNote(note.midi);
          void guitarPlayer.startSustainMidi(note.midi);
        },
        onOuterPressEnd: () => {
          circleUi?.releaseHeldNotes();
          guitarPlayer.stopSustain();
        },
        onSecondaryPressStart: (chord) => {
          suppressNextTapPlayback = true;
          const chordMidis = getCircleChordMidis(chord);
          circleUi?.holdChord(chordMidis);
          void guitarPlayer.startSustainChord(chordMidis);
        },
        onSecondaryPressEnd: () => {
          circleUi?.releaseHeldNotes();
          guitarPlayer.stopSustain();
        },
      });
      circleUi.setInstrumentLabel(initialInstrumentName);
    },
    onExit: () => {
      clearRandomnessTimeout();
      stopChordModeAnimation();
      chordModeActive = false;
      lastPrimaryLabel = null;
      options.onRandomnessChange?.(null);
      circleUi?.releaseHeldNotes();
      guitarPlayer.stopSustain();
      guitarPlayer.stopAll();
      circleUi?.destroy();
      circleUi = null;
    },
  };
}
