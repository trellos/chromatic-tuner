import {
  createDrumMachineUi,
  getDrumRandomnessForBeat,
  getDrumSoundingBeatIndicesFromFlags,
} from "../ui/drum-machine.js";
import type { ModeDefinition } from "./types.js";
import { clamp } from "../utils.js";
import { seigaihaBridge } from "../app/seigaiha-bridge.js";
import { getDrumRandomnessTarget } from "../app/debug-params.js";
import { setCarouselHidden } from "../app/carousel-bridge.js";

export { getDrumRandomnessForBeat, getDrumSoundingBeatIndicesFromFlags };

const DEFAULT_RANDOMNESS_TARGET = 0.9;

export function createDrumMachineMode(): ModeDefinition {
  const modeEl = document.querySelector<HTMLElement>('.mode-screen[data-mode="drum-machine"]');
  const drumHostEl = modeEl?.querySelector<HTMLElement>("[data-drum-host]") ?? null;
  // Mode-level controls that live outside the drum widget's DOM.
  const fullscreenToggle = modeEl?.querySelector<HTMLButtonElement>("#carousel-toggle") ?? null;
  const fullscreenExit = modeEl?.querySelector<HTMLButtonElement>("#drum-exit") ?? null;
  let modeAbort: AbortController | null = null;
  let lastRandomness = Number.NaN;

  const emitRandomness = (next: number | null): void => {
    if (next === null || !Number.isFinite(next)) {
      lastRandomness = Number.NaN;
      seigaihaBridge.setModeRandomness(null);
      return;
    }
    const clamped = clamp(next, 0, 1);
    if (Number.isFinite(lastRandomness) && Math.abs(clamped - lastRandomness) <= 0.0005) return;
    lastRandomness = clamped;
    seigaihaBridge.setModeRandomness(clamped);
  };

  const getRandomnessTarget = (): number =>
    clamp(getDrumRandomnessTarget() ?? DEFAULT_RANDOMNESS_TARGET, 0, 1);

  // Create the drum widget. It generates its own DOM.
  // UI -> mode callback usage:
  // - transport start/stop reset mode-owned randomness envelope.
  // - beat boundary drives deterministic per-beat randomness interpolation.
  // These callbacks intentionally avoid direct UI mutation.
  const drumUi = createDrumMachineUi({
    onTransportStart: () => { emitRandomness(0); },
    onTransportStop: () => { emitRandomness(0); },
    onBeatBoundary: ({ beatIndex, beatHasSound, soundingBeatIndices }) => {
      if (beatIndex === 0) { emitRandomness(0); }
      if (!beatHasSound) return;
      const next = getDrumRandomnessForBeat({
        beatIndex,
        soundingBeatIndices,
        target: getRandomnessTarget(),
      });
      if (next !== null) emitRandomness(next);
    },
  });

  // Append the widget's root to the host div in the mode screen.
  if (drumHostEl) {
    drumHostEl.appendChild(drumUi.rootEl);
  }

  // The share button lives inside the drum widget's generated DOM.
  const shareButton = drumUi.rootEl.querySelector<HTMLButtonElement>("[data-drum-share]") ?? null;

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
        fullscreenToggle.addEventListener("click", () => setCarouselHidden(true), { signal });
      }
      if (fullscreenExit) {
        fullscreenExit.addEventListener("click", () => setCarouselHidden(false), { signal });
      }
      if (shareButton) {
        shareButton.addEventListener(
          "click",
          () => {
            const shareUrl = drumUi.getShareUrl();
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
      await drumUi.enter();
    },
    onExit: () => {
      modeAbort?.abort();
      modeAbort = null;
      if (fullscreenToggle) fullscreenToggle.disabled = true;
      drumUi.exit();
      emitRandomness(null);
    },
  };
}
