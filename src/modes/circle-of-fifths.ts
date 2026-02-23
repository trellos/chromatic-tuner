import { createCircleGuitarPlayer } from "../audio/circle-guitar-player.js";
import {
  createCircleOfFifthsUi,
  getCircleChordMidis,
  type CircleChordSpec,
} from "../ui/circle-of-fifths.js";
import type { ModeDefinition } from "./types.js";

type CircleOfFifthsModeOptions = {
  onRandomnessChange?: (randomness: number | null) => void;
  onPulse?: () => void;
};

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

  const triggerPlaybackRandomness = (durationMs: number): void => {
    if (randomnessTimer !== null) {
      window.clearTimeout(randomnessTimer);
      randomnessTimer = null;
    }
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
    triggerPlaybackRandomness(420);
    await guitarPlayer.playMidi(midi, 400);
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
          void playPrimary(selection.primaryMidi);
        },
        onSecondaryTap: (chord) => {
          void playChord(chord);
        },
      });
    },
    onExit: () => {
      if (randomnessTimer !== null) {
        window.clearTimeout(randomnessTimer);
        randomnessTimer = null;
      }
      options.onRandomnessChange?.(null);
      guitarPlayer.stopAll();
      circleUi?.destroy();
      circleUi = null;
    },
  };
}
