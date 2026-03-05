import { createCircleGuitarPlayer } from "../audio/circle-guitar-player.js";
import { seigaihaBridge } from "../app/seigaiha-bridge.js";
import {
  createCircleOfFifthsUi,
  getCircleChordMidis,
  getCircleMajorChordMidis,
  type CircleChordSpec,
} from "../ui/circle-of-fifths.js";
import type { ModeDefinition } from "./types.js";

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
    preserveState: false,
    canFullscreen: false,
    onEnter: () => {
      // Recreate UI each entry to avoid stale listeners/state between mode switches.
      if (!mountEl) return;

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
        onOuterTap: (note) => {
          // CW zone plays major chord; CCW zone plays single note.
          if (shouldSuppressTapPlayback()) return;
          if (note.zone === "chord") {
            if (shouldDebounceTapPlayback(`maj:${note.midi}`)) return;
            void playMajorChord(note.midi);
          } else {
            if (shouldDebounceTapPlayback(`note:${note.midi}`)) return;
            void playPrimary(note.midi);
          }
        },
        onBackgroundTap: () => {
          circleUi?.releaseHeldNotes();
          guitarPlayer.stopSustain();
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
          // CW zone hold sustains chord; CCW zone hold sustains single note.
          if (note.zone === "chord") {
            const chordMidis = getCircleMajorChordMidis(note.midi);
            circleUi?.holdChord(chordMidis);
            void guitarPlayer.startSustainChord(chordMidis);
          } else {
            circleUi?.holdNote(note.midi);
            void guitarPlayer.startSustainMidi(note.midi);
          }
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

      options.onRandomnessChange?.(null);
      circleUi?.releaseHeldNotes();
      guitarPlayer.stopSustain();
      guitarPlayer.stopAll();
      circleUi?.destroy();
      circleUi = null;
    },
  };
}
