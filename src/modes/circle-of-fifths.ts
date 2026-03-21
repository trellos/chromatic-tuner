import { createCircleGuitarPlayer } from "../audio/circle-guitar-player.js";
import { createCircleAudioController } from "../app/circle-audio-controller.js";
import { seigaihaBridge } from "../app/seigaiha-bridge.js";
import { createCircleOfFifthsUi } from "../ui/circle-of-fifths.js";
import type { ModeDefinition } from "./types.js";

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
  const circleAudio = createCircleAudioController({
    player: guitarPlayer,
    getUi: () => circleUi,
  });

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

  return {
    id: "circle-of-fifths",
    title: "Circle of Fifths",
    preserveState: false,
    canFullscreen: false,
    onEnter: () => {
      if (!mountEl) return;

      circleAudio.resetInteractionState();
      circleUi?.destroy();
      const initialInstrumentName = circleAudio.setInstrument("guitar-acoustic");
      // Keep sample bytes warm between entries so the shared interaction controller
      // can still hit pointerdown playback without a fetch on the first press.
      circleAudio.preloadCurrentInstrument();
      circleUi = createCircleOfFifthsUi(mountEl, {
        ...circleAudio.getInteractionOptions(),
        onBackgroundPulseRequest: () => {
          options.onPulse?.();
        },
        onBackgroundRandomnessRequest: (randomness) => {
          const clamped = Math.min(1, Math.max(0, randomness));
          triggerPlaybackRandomness(clamped >= 0.75 ? 650 : 420);
        },
        onInnerDoubleTap: () => {
          const instrumentName = circleAudio.cycleInstrument();
          circleUi?.setInstrumentLabel(instrumentName);
          circleUi?.showInnerIndicator(instrumentName);
        },
      });
      circleUi.setInstrumentLabel(initialInstrumentName);
    },
    onExit: () => {
      clearRandomnessTimeout();
      options.onRandomnessChange?.(null);
      circleAudio.stopAll();
      circleUi?.destroy();
      circleUi = null;
    },
  };
}
