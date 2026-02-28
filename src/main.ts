import type { ModeDefinition, ModeId } from "./modes/types.js";
import { createTunerMode } from "./modes/tuner.js";
import { createMetronomeMode } from "./modes/metronome.js";
import { createDrumMachineMode } from "./modes/drum-machine.js";
import { createFretboardMode, preloadFretboardAudioAssets } from "./modes/fretboard.js";
import { createCircleOfFifthsMode } from "./modes/circle-of-fifths.js";
import { createWildTunaMode } from "./modes/wild-tuna.js";
import { runModeTransition } from "./mode-transition.js";
import { createCircleOfFifthsUi } from "./ui/circle-of-fifths.js";
import { createDrumMachineUi } from "./ui/drum-machine.js";
import { installSeigaihaBackground, pulseSeigaihaRandomness } from "./ui/seigaihaBackground.js";
import { bindSeigaihaDebugControl } from "./ui/seigaiha-debug-panel.js";
import { bindModeSwipe } from "./ui/swipe-gesture.js";
import { initializeCarouselUi, type CarouselController } from "./ui/carousel.js";
import { registerCarouselHiddenHandler } from "./app/carousel-bridge.js";
import {
  getMetronomeRandomnessParams,
  setMetronomeRandomnessParams,
  getDrumRandomnessTarget,
  setDrumRandomnessTarget,
} from "./app/debug-params.js";

declare global {
  interface Window {
    __tunaUiObjects?: {
      createCircleOfFifthsUi: typeof createCircleOfFifthsUi;
      createDrumMachineUi: typeof createDrumMachineUi;
    };
  }
}

// Mode order drives the carousel and swipe navigation.
const MODE_REGISTRY: ModeDefinition[] = [
  createTunerMode(),
  createMetronomeMode(),
  createFretboardMode(),
  createCircleOfFifthsMode(),
  createDrumMachineMode(),
  createWildTunaMode(),
];

const carouselShowEl = document.getElementById("carousel-show");
const modeDots = document.querySelectorAll<HTMLButtonElement>(".mode-dot[data-mode]");
const modeStageEl = document.querySelector<HTMLElement>(".mode-stage");
const modeScreens = document.querySelectorAll<HTMLElement>(".mode-screen[data-mode]");

const LAST_MODE_STORAGE_KEY = "tuna.lastMode";

let activeModeId: ModeId = "tuner";
let isSwitching = false;
let syncDebugPanel: (() => void) | null = null;
let carousel: CarouselController | null = null;
let enterFullscreenAbort: AbortController | null = null;

// Keeps drum-fullscreen / wild-tuna-fullscreen body classes in sync whenever
// either the carousel-hidden state or the active mode changes.
function syncFullscreenBodyClasses(isCarouselHidden: boolean): void {
  document.body.classList.toggle("drum-fullscreen", isCarouselHidden && activeModeId === "drum-machine");
  document.body.classList.toggle("wild-tuna-fullscreen", isCarouselHidden && activeModeId === "wild-tuna");
}

// Restarts the wild-tuna jump animation on fullscreen entry. Uses animationend
// (not a hardcoded timeout) and an AbortController so rapid toggles don't stack.
function triggerWildTunaJumpAnimation(): void {
  enterFullscreenAbort?.abort();
  const abort = new AbortController();
  enterFullscreenAbort = abort;
  document.body.classList.remove("wild-tuna-enter-fullscreen");
  // Force a style flush so re-adding the class restarts the animation.
  void document.body.offsetWidth;
  document.body.classList.add("wild-tuna-enter-fullscreen");
  document.body.addEventListener(
    "animationend",
    () => {
      document.body.classList.remove("wild-tuna-enter-fullscreen");
      if (enterFullscreenAbort === abort) enterFullscreenAbort = null;
    },
    { once: true, signal: abort.signal }
  );
}

function cancelWildTunaJumpAnimation(): void {
  enterFullscreenAbort?.abort();
  enterFullscreenAbort = null;
  document.body.classList.remove("wild-tuna-enter-fullscreen");
}

window.__tunaUiObjects = { createCircleOfFifthsUi, createDrumMachineUi };

function parseModeId(value: string | null): ModeId | null {
  if (!value) return null;
  return MODE_REGISTRY.some((mode) => mode.id === value) ? (value as ModeId) : null;
}

function readLastModeId(): ModeId | null {
  try {
    return parseModeId(window.localStorage.getItem(LAST_MODE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeLastModeId(modeId: ModeId): void {
  try {
    window.localStorage.setItem(LAST_MODE_STORAGE_KEY, modeId);
  } catch {
    // Ignore storage failures (private mode / restricted environments).
  }
}

function resolveInitialModeId(): ModeId {
  const params = new URLSearchParams(window.location.search);
  if (params.has("track")) return "drum-machine";
  return parseModeId(params.get("mode")) ?? readLastModeId() ?? "tuner";
}

function getModeById(id: ModeId): ModeDefinition | undefined {
  return MODE_REGISTRY.find((mode) => mode.id === id);
}

function getModeByOffset(offset: number): ModeId | null {
  const order = MODE_REGISTRY.map((mode) => mode.id);
  const currentIndex = order.indexOf(activeModeId);
  if (currentIndex === -1) return null;
  const nextIndex = (currentIndex + offset + order.length) % order.length;
  const nextMode = order[nextIndex];
  return nextMode ?? null;
}

// Mode flow architecture:
// 1) UI intent (dot click or swipe) picks a target mode and calls switchMode(target).
// 2) switchMode runs lifecycle hooks in order: current.onExit -> UI state swap -> next.onEnter.
// 3) UI state swap updates active screen classes, ARIA state, and fullscreen/body flags.
// 4) Errors are caught so the app can recover, and isSwitching is always reset in finally.
async function switchMode(id: ModeId): Promise<void> {
  if (isSwitching || id === activeModeId) return;
  isSwitching = true;
  const previousMode = getModeById(activeModeId);
  const nextMode = getModeById(id);
  try {
    const transitionPlan = {
      applyUiState: () => {
        activeModeId = id;
        writeLastModeId(activeModeId);
        carousel?.updateCarouselState();
        carousel?.setActiveScreen(id);
        if (!nextMode?.canFullscreen) {
          // setCarouselHidden(false) fires onHiddenChange → syncFullscreenBodyClasses.
          carousel?.setCarouselHidden(false);
        } else {
          // Mode supports fullscreen: keep carousel-hidden state but re-sync
          // body classes since activeModeId just changed.
          syncFullscreenBodyClasses(document.body.classList.contains("carousel-hidden"));
        }
      },
      onError: (error: unknown) => {
        console.error("Mode switch failed", error);
      },
      ...(previousMode?.onExit ? { exitCurrent: previousMode.onExit } : {}),
      ...(nextMode?.onEnter ? { enterNext: nextMode.onEnter } : {}),
    };
    await runModeTransition(transitionPlan);
  } finally {
    isSwitching = false;
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  preloadFretboardAudioAssets();
  installSeigaihaBackground();

  // Pulse seigaiha on any button click.
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest<HTMLButtonElement>("button")) pulseSeigaihaRandomness();
  });

  // Wire the debug panel — it needs callbacks to read/write debug-params.
  syncDebugPanel = bindSeigaihaDebugControl({
    getActiveModeId: () => activeModeId,
    getMetronomeParams: getMetronomeRandomnessParams,
    setMetronomeParams: setMetronomeRandomnessParams,
    getDrumTarget: getDrumRandomnessTarget,
    setDrumTarget: setDrumRandomnessTarget,
  });

  // Build the carousel controller.
  carousel = initializeCarouselUi({
    carouselShowEl: carouselShowEl as HTMLElement | null,
    modeDots,
    modeScreens,
    getActiveModeId: () => activeModeId,
    getSyncDebugPanel: () => syncDebugPanel,
    onSwitchRequest: (id) => void switchMode(id),
    // Own all mode-specific fullscreen body-class policy here, not in carousel.ts.
    onHiddenChange: (hidden) => {
      syncFullscreenBodyClasses(hidden);
      if (hidden && activeModeId === "wild-tuna") {
        triggerWildTunaJumpAnimation();
      } else {
        cancelWildTunaJumpAnimation();
      }
    },
  });

  // Register the carousel-bridge handler so modes can call setCarouselHidden().
  registerCarouselHiddenHandler((hidden) => {
    carousel?.setCarouselHidden(hidden);
  });

  // Wire swipe gestures.
  if (modeStageEl) {
    bindModeSwipe({
      modeStageEl,
      modeScreens,
      getActiveModeId: () => activeModeId,
      getModeByOffset,
      getIsSwitching: () => isSwitching,
      onSwitchRequest: (id) => void switchMode(id),
      onClearFullscreen: () => carousel?.setCarouselHidden(false),
    });
  }

  activeModeId = resolveInitialModeId();
  writeLastModeId(activeModeId);
  carousel.updateCarouselState();
  carousel.setActiveScreen(activeModeId);
  syncDebugPanel?.();

  const initialMode = getModeById(activeModeId);
  if (initialMode?.onEnter) {
    await initialMode.onEnter();
  }
});
