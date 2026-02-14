import type { ModeDefinition, ModeId } from "./modes/types.js";
import { createTunerMode } from "./modes/tuner.js";
import { createMetronomeMode } from "./modes/metronome.js";
import { createDrumMachineMode } from "./modes/drum-machine.js";

const carouselEl = document.getElementById("mode-carousel");
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

function switchByOffset(offset: number): void {
  const order = getModeOrder();
  const currentIndex = order.indexOf(activeModeId);
  if (currentIndex === -1) return;
  const nextIndex = (currentIndex + offset + order.length) % order.length;
  const nextMode = order[nextIndex];
  if (!nextMode) return;
  void switchMode(nextMode);
  setCarouselHidden(false);
}

function bindModeSwipe(): void {
  if (!modeStageEl) return;
  let startX = 0;
  let startY = 0;

  modeStageEl.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
    },
    { passive: true }
  );

  modeStageEl.addEventListener(
    "touchend",
    (event) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      switchByOffset(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );
}

async function switchMode(id: ModeId): Promise<void> {
  if (isSwitching || id === activeModeId) return;
  isSwitching = true;
  const previousMode = getModeById(activeModeId);
  const nextMode = getModeById(id);

  if (previousMode?.onExit) {
    await previousMode.onExit();
  }

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

  if (nextMode?.onEnter) {
    await nextMode.onEnter();
  }
  isSwitching = false;
}

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
