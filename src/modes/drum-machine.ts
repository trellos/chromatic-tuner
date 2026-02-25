import {
  createDrumMachineUi,
  getDrumRandomnessForBeat,
  getDrumSoundingBeatIndicesFromFlags,
} from "../ui/drum-machine.js";
import type { ModeDefinition } from "./types.js";
import { clamp } from "../utils.js";

export { getDrumRandomnessForBeat, getDrumSoundingBeatIndicesFromFlags };

type DrumMachineModeOptions = {
  onRandomnessChange?: (randomness: number | null) => void;
  getRandomnessTarget?: () => number;
  onRequestFullscreen?: () => void;
  onExitFullscreen?: () => void;
};

const DEFAULT_RANDOMNESS_TARGET = 0.9;

export function createDrumMachineMode(options: DrumMachineModeOptions = {}): ModeDefinition {
  const modeEl = document.querySelector<HTMLElement>('.mode-screen[data-mode="drum-machine"]');
  const fullscreenToggle = modeEl?.querySelector<HTMLButtonElement>("#carousel-toggle") ?? null;
  const fullscreenExit = modeEl?.querySelector<HTMLButtonElement>("#drum-exit") ?? null;
  const shareButton = modeEl?.querySelector<HTMLButtonElement>("#drum-share-button") ?? null;
  let modeAbort: AbortController | null = null;
  let lastRandomness = Number.NaN;

  const emitRandomness = (next: number | null): void => {
    if (next === null || !Number.isFinite(next)) {
      lastRandomness = Number.NaN;
      options.onRandomnessChange?.(null);
      return;
    }
    const clamped = clamp(next, 0, 1);
    if (Number.isFinite(lastRandomness) && Math.abs(clamped - lastRandomness) <= 0.0005) return;
    lastRandomness = clamped;
    options.onRandomnessChange?.(clamped);
  };

  const getRandomnessTarget = (): number =>
    clamp(options.getRandomnessTarget?.() ?? DEFAULT_RANDOMNESS_TARGET, 0, 1);

  const drumUi = modeEl
    ? createDrumMachineUi(modeEl, {
        // UI -> mode callback usage:
        // - transport start/stop reset mode-owned randomness envelope.
        // - beat boundary drives deterministic per-beat randomness interpolation.
        // These callbacks intentionally avoid direct UI mutation.
        onTransportStart: () => {
          emitRandomness(0);
        },
        onTransportStop: () => {
          emitRandomness(0);
        },
        onBeatBoundary: ({ beatIndex, beatHasSound, soundingBeatIndices }) => {
          if (beatIndex === 0) {
            emitRandomness(0);
          }
          if (!beatHasSound) return;
          const next = getDrumRandomnessForBeat({
            beatIndex,
            soundingBeatIndices,
            target: getRandomnessTarget(),
          });
          if (next !== null) emitRandomness(next);
        },
      })
    : null;

  return {
    id: "drum-machine",
    title: "Drum Machine",
    icon: "DR",
    preserveState: true,
    canFullscreen: true,
    onEnter: async () => {
      modeAbort?.abort();
      modeAbort = new AbortController();
      const { signal } = modeAbort;
      if (fullscreenToggle) {
        fullscreenToggle.disabled = false;
        fullscreenToggle.addEventListener("click", () => options.onRequestFullscreen?.(), {
          signal,
        });
      }
      if (fullscreenExit) {
        fullscreenExit.addEventListener("click", () => options.onExitFullscreen?.(), { signal });
      }
      if (shareButton) {
        shareButton.addEventListener(
          "click",
          () => {
            const shareUrl = drumUi?.getShareUrl();
            if (!shareUrl) return;
            void (async () => {
              try {
                if (navigator.clipboard?.writeText) {
                  await navigator.clipboard.writeText(shareUrl);
                  shareButton.setAttribute("aria-label", "Share URL copied");
                } else {
                  window.prompt("Copy this drum track URL", shareUrl);
                }
              } catch {
                window.prompt("Copy this drum track URL", shareUrl);
              }
            })();
          },
          { signal }
        );
      }
      emitRandomness(0);
      await drumUi?.enter();
    },
    onExit: () => {
      modeAbort?.abort();
      modeAbort = null;
      if (fullscreenToggle) {
        fullscreenToggle.disabled = true;
      }
      drumUi?.exit();
      emitRandomness(null);
    },
  };
}
