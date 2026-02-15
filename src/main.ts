import type { ModeDefinition, ModeId } from "./modes/types.js";
import { createTunerMode } from "./modes/tuner.js";
import { createMetronomeMode } from "./modes/metronome.js";
import { createDrumMachineMode } from "./modes/drum-machine.js";
import { runModeTransition } from "./mode-transition.js";
const carouselToggleEl = document.getElementById("carousel-toggle");
const carouselShowEl = document.getElementById("carousel-show");
const drumExitEl = document.getElementById("drum-exit");
const modeDots =
  document.querySelectorAll<HTMLButtonElement>(".mode-dot[data-mode]") ?? [];
const modeStageEl = document.querySelector<HTMLElement>(".mode-stage");
const modeScreens =
  document.querySelectorAll<HTMLElement>(".mode-screen[data-mode]") ?? [];

const MODE_REGISTRY: ModeDefinition[] = [
  createTunerMode(),
  createMetronomeMode(),
  createDrumMachineMode(),
];

let activeModeId: ModeId = "tuner";
let isSwitching = false;
let swipeStartX = 0;
let swipeStartY = 0;
let swipeDx = 0;
let swipeDirection: 1 | -1 | null = null;
let swipeActiveScreen: HTMLElement | null = null;
let swipeTargetScreen: HTMLElement | null = null;
let swipeTargetMode: ModeId | null = null;
let isSwipeDragging = false;

function getModeById(id: ModeId): ModeDefinition | undefined {
  return MODE_REGISTRY.find((mode) => mode.id === id);
}

function setCarouselHidden(hidden: boolean): void {
  document.body.classList.toggle("carousel-hidden", hidden);
  if (carouselShowEl) {
    carouselShowEl.setAttribute("aria-hidden", hidden ? "false" : "true");
  }
  document.body.classList.toggle(
    "drum-fullscreen",
    hidden && activeModeId === "drum-machine"
  );
}

function updateCarouselState(): void {
  const activeMode = getModeById(activeModeId);
  modeDots.forEach((dot) => {
    const isActive = dot.dataset.mode === activeModeId;
    dot.classList.toggle("is-active", isActive);
    dot.setAttribute("aria-selected", String(isActive));
  });
  if (carouselToggleEl) {
    (carouselToggleEl as HTMLButtonElement).disabled = !activeMode?.canFullscreen;
  }
}

function setActiveScreen(id: ModeId): void {
  modeScreens.forEach((screen) => {
    const isActive = screen.dataset.mode === id;
    screen.classList.toggle("is-active", isActive);
    screen.setAttribute("aria-hidden", String(!isActive));
  });
}

function getModeOrder(): ModeId[] {
  return MODE_REGISTRY.map((mode) => mode.id);
}

function getModeByOffset(offset: number): ModeId | null {
  const order = getModeOrder();
  const currentIndex = order.indexOf(activeModeId);
  if (currentIndex === -1) return null;
  const nextIndex = (currentIndex + offset + order.length) % order.length;
  const nextMode = order[nextIndex];
  return nextMode ?? null;
}

function switchByOffset(offset: number): void {
  const nextMode = getModeByOffset(offset);
  if (!nextMode) return;
  void switchMode(nextMode);
  setCarouselHidden(false);
}

function getScreenByMode(modeId: ModeId): HTMLElement | null {
  return (
    Array.from(modeScreens).find((screen) => screen.dataset.mode === modeId) ?? null
  );
}

function clearSwipeState(): void {
  swipeStartX = 0;
  swipeStartY = 0;
  swipeDx = 0;
  swipeDirection = null;
  swipeTargetMode = null;
  isSwipeDragging = false;
  if (modeStageEl) {
    modeStageEl.classList.remove("is-swiping");
  }
  [swipeActiveScreen, swipeTargetScreen].forEach((screen) => {
    if (!screen) return;
    screen.classList.remove("is-swipe-active");
    screen.style.transition = "";
    screen.style.transform = "";
  });
  swipeActiveScreen = null;
  swipeTargetScreen = null;
}

// Prepares the active and incoming panels so horizontal drag can
// render both screens together during a mode swipe.
function setupSwipeScreens(direction: 1 | -1): void {
  if (!modeStageEl) return;
  const nextMode = getModeByOffset(direction);
  const activeScreen = getScreenByMode(activeModeId);
  if (!nextMode || !activeScreen) {
    clearSwipeState();
    return;
  }
  const nextScreen = getScreenByMode(nextMode);
  if (!nextScreen) {
    clearSwipeState();
    return;
  }
  swipeDirection = direction;
  swipeTargetMode = nextMode;
  swipeActiveScreen = activeScreen;
  swipeTargetScreen = nextScreen;
  modeStageEl.classList.add("is-swiping");
  swipeActiveScreen.classList.add("is-swipe-active");
  swipeTargetScreen.classList.add("is-swipe-active");
  swipeActiveScreen.style.transition = "none";
  swipeTargetScreen.style.transition = "none";
}

function renderSwipe(dx: number): void {
  if (!modeStageEl || !swipeDirection || !swipeActiveScreen || !swipeTargetScreen) return;
  const width = modeStageEl.getBoundingClientRect().width;
  const clampedDx = Math.max(-width, Math.min(width, dx));
  swipeDx = clampedDx;
  const targetOffset = swipeDirection === 1 ? width : -width;
  swipeActiveScreen.style.transform = `translate3d(${clampedDx}px, 0, 0)`;
  swipeTargetScreen.style.transform = `translate3d(${clampedDx + targetOffset}px, 0, 0)`;
}

async function animateSwipe(commit: boolean): Promise<void> {
  if (!modeStageEl || !swipeDirection || !swipeActiveScreen || !swipeTargetScreen) return;
  const width = modeStageEl.getBoundingClientRect().width;
  const targetOffset = swipeDirection === 1 ? width : -width;
  const activeTargetX = commit ? (swipeDirection === 1 ? -width : width) : 0;
  const targetTargetX = commit ? 0 : targetOffset;
  swipeActiveScreen.style.transition = "transform 220ms ease";
  swipeTargetScreen.style.transition = "transform 220ms ease";
  swipeActiveScreen.style.transform = `translate3d(${activeTargetX}px, 0, 0)`;
  swipeTargetScreen.style.transform = `translate3d(${targetTargetX}px, 0, 0)`;
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 260);
    swipeTargetScreen?.addEventListener(
      "transitionend",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

// Drives touch swipe gesture handling for mode changes, including
// drag-follow visuals and commit/cancel behavior.
function bindModeSwipe(): void {
  if (!modeStageEl) return;

  modeStageEl.addEventListener(
    "touchstart",
    (event) => {
      if (document.body.classList.contains("drum-fullscreen") || isSwitching) {
        clearSwipeState();
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      swipeStartX = touch.clientX;
      swipeStartY = touch.clientY;
      swipeDx = 0;
      swipeDirection = null;
      swipeTargetMode = null;
      isSwipeDragging = false;
    },
    { passive: true }
  );

  modeStageEl.addEventListener(
    "touchmove",
    (event) => {
      if (document.body.classList.contains("drum-fullscreen")) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - swipeStartX;
      const dy = touch.clientY - swipeStartY;
      if (!isSwipeDragging) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dx) <= Math.abs(dy)) return;
        isSwipeDragging = true;
      }
      event.preventDefault();
      const direction: 1 | -1 = dx < 0 ? 1 : -1;
      if (!swipeDirection || swipeDirection !== direction) {
        setupSwipeScreens(direction);
      }
      renderSwipe(dx);
    },
    { passive: false }
  );

  modeStageEl.addEventListener(
    "touchcancel",
    () => {
      clearSwipeState();
    },
    { passive: true }
  );

  modeStageEl.addEventListener(
    "touchend",
    async (event) => {
      if (document.body.classList.contains("drum-fullscreen")) {
        clearSwipeState();
        return;
      }
      const touch = event.changedTouches[0];
      if (!touch) {
        clearSwipeState();
        return;
      }
      const dx = touch.clientX - swipeStartX;
      const dy = touch.clientY - swipeStartY;
      if (!isSwipeDragging || !swipeTargetMode || !swipeDirection) {
        clearSwipeState();
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
        switchByOffset(dx < 0 ? 1 : -1);
        return;
      }

      const width = modeStageEl.getBoundingClientRect().width;
      const shouldCommit = Math.abs(swipeDx) > width * 0.22;
      await animateSwipe(shouldCommit);
      const nextMode = shouldCommit ? swipeTargetMode : null;
      clearSwipeState();
      if (nextMode) {
        await switchMode(nextMode);
        setCarouselHidden(false);
      }
    },
    { passive: true }
  );
}

// Mode flow architecture:
// 1) UI intent (dot click or swipe) picks a target mode and calls switchMode(target).
// 2) switchMode runs lifecycle hooks in order: current.onExit -> UI state swap -> next.onEnter.
// 3) UI state swap updates active screen classes, ARIA state, and fullscreen/body flags.
// 4) Errors are caught so the app can recover, and isSwitching is always reset in finally.
// Keep this comment updated as this flow changes so implementation and docs stay aligned.
async function switchMode(id: ModeId): Promise<void> {
  if (isSwitching || id === activeModeId) return;
  isSwitching = true;
  const previousMode = getModeById(activeModeId);
  const nextMode = getModeById(id);
  try {
    await runModeTransition({
      exitCurrent: previousMode?.onExit,
      applyUiState: () => {
        activeModeId = id;
        updateCarouselState();
        setActiveScreen(id);
        document.body.classList.toggle(
          "drum-fullscreen",
          document.body.classList.contains("carousel-hidden") &&
            activeModeId === "drum-machine"
        );
        if (!nextMode?.canFullscreen) {
          setCarouselHidden(false);
        }
      },
      enterNext: nextMode?.onEnter,
      onError: (error) => {
        console.error("Mode switch failed", error);
      },
    });
  } finally {
    isSwitching = false;
  }
}

// Wires mode dot/fullscreen controls and applies initial active mode UI state.
function initializeCarouselUi(): void {
  modeDots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const modeId = dot.dataset.mode as ModeId | undefined;
      if (!modeId) return;
      void switchMode(modeId);
      setCarouselHidden(false);
    });
  });

  if (carouselToggleEl) {
    carouselToggleEl.addEventListener("click", () => {
      const activeMode = getModeById(activeModeId);
      if (!activeMode?.canFullscreen) return;
      setCarouselHidden(true);
    });
  }

  if (drumExitEl) {
    drumExitEl.addEventListener("click", () => {
      setCarouselHidden(false);
    });
  }

  if (carouselShowEl) {
    carouselShowEl.addEventListener("click", () => {
      setCarouselHidden(false);
    });
  }

  updateCarouselState();
  setActiveScreen(activeModeId);
  bindModeSwipe();
}

// Auto-start tuner mode on page load until the carousel is wired up.
window.addEventListener("DOMContentLoaded", async () => {
  initializeCarouselUi();
  const tunerMode = MODE_REGISTRY.find((mode) => mode.id === "tuner");
  if (tunerMode?.onEnter) {
    await tunerMode.onEnter();
  }
});

