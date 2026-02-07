import type { ModeDefinition, ModeId } from "./modes/types.js";
import { createTunerMode } from "./modes/tuner.js";
import { createMetronomeMode } from "./modes/metronome.js";
import { createDrumMachineMode } from "./modes/drum-machine.js";

const carouselEl = document.getElementById("mode-carousel");
const carouselToggleEl = document.getElementById("carousel-toggle");
const carouselShowEl = document.getElementById("carousel-show");
const drumExitEl = document.getElementById("drum-exit");
const modeButtons =
  carouselEl?.querySelectorAll<HTMLButtonElement>("[data-mode]") ?? [];
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
  modeButtons.forEach((btn) => {
    const isActive = btn.dataset.mode === activeModeId;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });
  if (carouselToggleEl) {
    (carouselToggleEl as HTMLButtonElement).disabled = !activeMode?.canFullscreen;
  }
}

function setActiveScreen(id: ModeId): void {
  modeScreens.forEach((screen) => {
    const isActive = screen.dataset.mode === id;
    screen.classList.toggle("is-active", isActive);
  });
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
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const modeId = btn.dataset.mode as ModeId | undefined;
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
}

// Auto-start tuner mode on page load until the carousel is wired up.
window.addEventListener("DOMContentLoaded", async () => {
  initializeCarouselUi();
  const tunerMode = MODE_REGISTRY.find((mode) => mode.id === "tuner");
  if (tunerMode?.onEnter) {
    await tunerMode.onEnter();
  }
});
