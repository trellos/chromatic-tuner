import type { CircleGuitarPlayer, CircleInstrumentId } from "../audio/circle-guitar-player.js";
import { createAudioSession, type AudioSession } from "./audio-session.js";
import {
  getCircleChordMidis,
  getCircleMajorChordMidis,
  type CircleChordSpec,
  type CircleNoteTap,
  type CircleOfFifthsUi,
  type CircleOfFifthsUiOptions,
} from "../ui/circle-of-fifths.js";

const TAP_PLAYBACK_DEBOUNCE_MS = 440;

type CircleAudioSource = "outer" | "secondary" | "note-bar";

type CircleAudioControllerOptions = {
  player: CircleGuitarPlayer;
  getUi: () => CircleOfFifthsUi | null;
  audioSession?: AudioSession<"circle", CircleAudioSource>;
};

export type CircleAudioController = {
  getInteractionOptions: () => Pick<
    CircleOfFifthsUiOptions,
    | "onBackgroundTap"
    | "onOuterTap"
    | "onOuterPressStart"
    | "onOuterPressEnd"
    | "onSecondaryTap"
    | "onSecondaryPressStart"
    | "onSecondaryPressEnd"
    | "onNoteBarTap"
    | "onNoteBarPressStart"
    | "onNoteBarPressEnd"
  >;
  resetInteractionState: () => void;
  preloadCurrentInstrument: () => void;
  setInstrument: (instrumentId: CircleInstrumentId) => string;
  cycleInstrument: () => string;
  releaseAll: () => void;
  stopAll: () => void;
};

export function createCircleAudioController(
  options: CircleAudioControllerOptions
): CircleAudioController {
  const audioSession = options.audioSession ?? createAudioSession<"circle", CircleAudioSource>();
  const holdIds = new Map<CircleAudioSource, string>();
  let suppressNextTapPlayback = false;
  let lastTapPlaybackAt = 0;
  let lastTapPlaybackSignature = "";

  audioSession.registerInstrument("circle", {
    playPulse: (midis, durationMs) => {
      const ui = options.getUi();
      if (midis.length === 1) {
        const midi = midis[0];
        if (midi !== undefined) {
          ui?.pulseNote(midi, durationMs);
          void options.player.playMidi(midi, durationMs);
        }
        return;
      }
      ui?.pulseChord(midis, durationMs);
      void options.player.playChord(midis, durationMs);
    },
    startHold: (midis) => {
      const ui = options.getUi();
      if (midis.length === 1) {
        const midi = midis[0];
        if (midi !== undefined) {
          ui?.holdNote(midi);
          void options.player.startSustainMidi(midi);
        }
        return;
      }
      ui?.holdChord(midis);
      void options.player.startSustainChord(midis);
    },
    stopHold: () => {
      options.getUi()?.releaseHeldNotes();
      options.player.stopSustain();
    },
    stopAll: () => {
      options.getUi()?.releaseHeldNotes();
      options.player.stopAll();
    },
  });

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

  const playPulse = (source: CircleAudioSource, midis: number[], durationMs: number): void => {
    audioSession.playPulse({ instrumentId: "circle", source, midis, durationMs });
  };

  const startHold = (source: CircleAudioSource, midis: number[]): void => {
    const previousId = holdIds.get(source);
    if (previousId) {
      audioSession.stopHold(previousId);
    }
    const holdId = audioSession.startHold({ instrumentId: "circle", source, midis });
    if (!holdId) {
      holdIds.delete(source);
      return;
    }
    holdIds.set(source, holdId);
  };

  const stopHold = (source: CircleAudioSource): void => {
    const holdId = holdIds.get(source);
    if (!holdId) return;
    holdIds.delete(source);
    audioSession.stopHold(holdId);
  };

  const playPrimary = (midi: number, source: "outer" | "note-bar"): void => {
    playPulse(source, [midi], 400);
  };

  const playSecondaryChord = (chord: CircleChordSpec): void => {
    playPulse("secondary", getCircleChordMidis(chord), 640);
  };

  const playOuterInteraction = (note: CircleNoteTap): void => {
    if (note.zone === "chord") {
      playPulse("outer", getCircleMajorChordMidis(note.midi), 640);
      return;
    }
    playPrimary(note.midi, "outer");
  };

  const resetInteractionState = (): void => {
    suppressNextTapPlayback = false;
    lastTapPlaybackAt = 0;
    lastTapPlaybackSignature = "";
    holdIds.clear();
  };

  return {
    getInteractionOptions: () => ({
      onBackgroundTap: () => {
        audioSession.releaseAll();
        holdIds.clear();
      },
      onOuterTap: (note) => {
        if (shouldSuppressTapPlayback()) return;
        const signature = note.zone === "chord" ? `maj:${note.midi}` : `note:${note.midi}`;
        if (shouldDebounceTapPlayback(signature)) return;
        playOuterInteraction(note);
      },
      onOuterPressStart: (note) => {
        suppressNextTapPlayback = true;
        startHold("outer", note.zone === "chord" ? getCircleMajorChordMidis(note.midi) : [note.midi]);
      },
      onOuterPressEnd: () => {
        stopHold("outer");
      },
      onSecondaryTap: (chord) => {
        if (shouldSuppressTapPlayback()) return;
        if (shouldDebounceTapPlayback(`sec:${chord.label}`)) return;
        playSecondaryChord(chord);
      },
      onSecondaryPressStart: (chord) => {
        suppressNextTapPlayback = true;
        startHold("secondary", getCircleChordMidis(chord));
      },
      onSecondaryPressEnd: () => {
        stopHold("secondary");
      },
      onNoteBarTap: (note) => {
        suppressNextTapPlayback = false;
        playPrimary(note.midi, "note-bar");
      },
      onNoteBarPressStart: (note) => {
        suppressNextTapPlayback = true;
        startHold("note-bar", [note.midi]);
      },
      onNoteBarPressEnd: () => {
        stopHold("note-bar");
      },
    }),
    resetInteractionState,
    preloadCurrentInstrument: () => {
      options.player.preloadCurrentInstrument();
    },
    setInstrument: (instrumentId) => options.player.setInstrument(instrumentId),
    cycleInstrument: () => options.player.cycleInstrument(),
    releaseAll: () => {
      audioSession.releaseAll();
      holdIds.clear();
    },
    stopAll: () => {
      audioSession.stopAll();
      holdIds.clear();
    },
  };
}
