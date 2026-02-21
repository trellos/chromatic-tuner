import type { ModeDefinition, ModeId } from "./modes/types.js";
import { createTunerMode } from "./modes/tuner.js";
import {
  createMetronomeMode,
  type MetronomeRandomnessParams,
} from "./modes/metronome.js";
import { createDrumMachineMode } from "./modes/drum-machine.js";
import { runModeTransition } from "./mode-transition.js";
import {
  getSeigaihaDetuneMapping,
  getSeigaihaRandomness,
  getSeigaihaRenderStats,
  getSeigaihaTunerSmoothingTimeConstantMs,
  isSeigaihaDebugOverrideEnabled,
  installSeigaihaBackground,
  setSeigaihaDebugOverrideEnabled,
  setSeigaihaDetuneMagnitude,
  setSeigaihaDetuneMapping,
  setSeigaihaModeRandomness,
  setSeigaihaTunerSmoothingTimeConstantMs,
  setSeigaihaRandomness,
} from "./ui/seigaihaBackground.js";

const carouselToggleEl = document.getElementById("carousel-toggle");
const carouselShowEl = document.getElementById("carousel-show");
const drumExitEl = document.getElementById("drum-exit");
const modeDots =
  document.querySelectorAll<HTMLButtonElement>(".mode-dot[data-mode]") ?? [];
const modeStageEl = document.querySelector<HTMLElement>(".mode-stage");
const modeScreens =
  document.querySelectorAll<HTMLElement>(".mode-screen[data-mode]") ?? [];

const DEFAULT_METRONOME_RANDOMNESS_PARAMS: MetronomeRandomnessParams = {
  naMax: 0.2,
  inc44: 0.17,
  inc34: 0.2,
  inc68: 0.14,
  upCurve: 1.8,
  downCurve: 3.2,
};
const DEFAULT_DRUM_RANDOMNESS_TARGET = 0.9;

let metronomeRandomnessParams: MetronomeRandomnessParams = {
  ...DEFAULT_METRONOME_RANDOMNESS_PARAMS,
};
let drumRandomnessTarget = DEFAULT_DRUM_RANDOMNESS_TARGET;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const MODE_REGISTRY: ModeDefinition[] = [
  createTunerMode({
    onDetuneMagnitudeChange: (absCents) => {
      setSeigaihaDetuneMagnitude(absCents);
    },
  }),
  createMetronomeMode({
    onRandomnessChange: (randomness) => {
      setSeigaihaModeRandomness(randomness);
    },
    getRandomnessParams: () => metronomeRandomnessParams,
  }),
  createDrumMachineMode({
    onRandomnessChange: (randomness) => {
      setSeigaihaModeRandomness(randomness);
    },
    getRandomnessTarget: () => drumRandomnessTarget,
  }),
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
let syncSeigaihaDebugModeVisibility: (() => void) | null = null;

function parseModeId(value: string | null): ModeId | null {
  if (!value) return null;
  return MODE_REGISTRY.some((mode) => mode.id === value) ? (value as ModeId) : null;
}

function resolveInitialModeId(): ModeId {
  const params = new URLSearchParams(window.location.search);
  if (params.has("track")) return "drum-machine";
  return parseModeId(params.get("mode")) ?? "tuner";
}


function bindSeigaihaDebugControl(): void {
  const shouldShowDebugControl = new URLSearchParams(window.location.search).has(
    "debug"
  );
  if (!shouldShowDebugControl) return;

  const panel = document.createElement("div");
  panel.className = "seigaiha-debug-control";

  const title = document.createElement("p");
  title.className = "seigaiha-debug-title";
  title.textContent = "Seigaiha randomness";

  const tunerSection = document.createElement("section");
  tunerSection.className = "seigaiha-debug-section";
  tunerSection.setAttribute("data-debug-section", "tuner");

  const metronomeSection = document.createElement("section");
  metronomeSection.className = "seigaiha-debug-section";
  metronomeSection.setAttribute("data-debug-section", "metronome");

  const drumSection = document.createElement("section");
  drumSection.className = "seigaiha-debug-section";
  drumSection.setAttribute("data-debug-section", "drum-machine");

  const overrideRow = document.createElement("label");
  overrideRow.className = "seigaiha-debug-switch";
  overrideRow.setAttribute("for", "seigaiha-override-toggle");

  const overrideToggle = document.createElement("input");
  overrideToggle.type = "checkbox";
  overrideToggle.id = "seigaiha-override-toggle";
  overrideToggle.checked = isSeigaihaDebugOverrideEnabled();
  overrideToggle.setAttribute("aria-label", "Enable seigaiha slider override");
  overrideRow.appendChild(overrideToggle);
  overrideRow.append("OVR");

  const value = document.createElement("span");
  value.className = "seigaiha-debug-value";
  value.textContent = getSeigaihaRandomness().toFixed(2);

  const fps = document.createElement("span");
  fps.className = "seigaiha-debug-fps";
  fps.textContent = "FPS --";

  const smoothingRow = document.createElement("label");
  smoothingRow.className = "seigaiha-debug-switch";
  smoothingRow.setAttribute("for", "seigaiha-smoothing-ms");
  smoothingRow.append("SM");

  const smoothingInput = document.createElement("input");
  smoothingInput.type = "number";
  smoothingInput.id = "seigaiha-smoothing-ms";
  smoothingInput.min = "16";
  smoothingInput.max = "1000";
  smoothingInput.step = "1";
  smoothingInput.value = String(
    Math.round(getSeigaihaTunerSmoothingTimeConstantMs())
  );
  smoothingInput.setAttribute("aria-label", "Seigaiha tuner smoothing ms");
  smoothingInput.addEventListener("change", () => {
    const parsed = Number.parseFloat(smoothingInput.value);
    if (!Number.isFinite(parsed)) return;
    setSeigaihaTunerSmoothingTimeConstantMs(parsed);
    smoothingInput.value = String(
      Math.round(getSeigaihaTunerSmoothingTimeConstantMs())
    );
  });
  smoothingRow.appendChild(smoothingInput);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = "seigaiha-randomness-slider";
  slider.min = "0";
  slider.max = "1";
  slider.step = "0.01";
  slider.value = String(getSeigaihaRandomness());
  slider.disabled = !overrideToggle.checked;
  slider.setAttribute("aria-label", "Seigaiha randomness");

  const tableLabel = document.createElement("p");
  tableLabel.className = "seigaiha-debug-subtitle";
  tableLabel.textContent = "Detune mapping (abs cents)";

  const table = document.createElement("table");
  table.className = "seigaiha-debug-table";
  const tableHead = document.createElement("thead");
  tableHead.innerHTML =
    "<tr><th>Abs cents</th><th>Randomness</th></tr>";
  const tableBody = document.createElement("tbody");
  table.appendChild(tableHead);
  table.appendChild(tableBody);

  const metronomeLabel = document.createElement("p");
  metronomeLabel.className = "seigaiha-debug-subtitle";
  metronomeLabel.textContent = "Metronome params";

  const metronomeTable = document.createElement("table");
  metronomeTable.className = "seigaiha-debug-table seigaiha-debug-table--compact";
  const metronomeBody = document.createElement("tbody");
  metronomeTable.appendChild(metronomeBody);

  const drumLabel = document.createElement("p");
  drumLabel.className = "seigaiha-debug-subtitle";
  drumLabel.textContent = "Drum params";

  const drumTargetRow = document.createElement("label");
  drumTargetRow.className = "seigaiha-debug-switch";
  drumTargetRow.setAttribute("for", "seigaiha-drum-target");
  drumTargetRow.append("TG");

  const drumTargetInput = document.createElement("input");
  drumTargetInput.type = "number";
  drumTargetInput.id = "seigaiha-drum-target";
  drumTargetInput.min = "0";
  drumTargetInput.max = "1";
  drumTargetInput.step = "0.01";
  drumTargetInput.value = drumRandomnessTarget.toFixed(2);
  drumTargetInput.setAttribute("aria-label", "Drum randomness target");
  drumTargetInput.addEventListener("change", () => {
    const parsed = Number.parseFloat(drumTargetInput.value);
    if (!Number.isFinite(parsed)) return;
    drumRandomnessTarget = clamp(parsed, 0, 1);
    drumTargetInput.value = drumRandomnessTarget.toFixed(2);
  });
  drumTargetRow.appendChild(drumTargetInput);

  type MetronomeDebugField = {
    key: keyof MetronomeRandomnessParams;
    label: string;
    min?: number;
    max?: number;
    step?: number;
  };

  const metronomeFields: MetronomeDebugField[] = [
    { key: "naMax", label: "NA", min: 0, max: 1, step: 0.01 },
    { key: "inc44", label: "I44", min: 0, max: 1, step: 0.01 },
    { key: "inc34", label: "I34", min: 0, max: 1, step: 0.01 },
    { key: "inc68", label: "I68", min: 0, max: 1, step: 0.01 },
    { key: "upCurve", label: "UP", min: 1, max: 6, step: 0.05 },
    { key: "downCurve", label: "DN", min: 1, max: 8, step: 0.05 },
  ];

  function setMetronomeParam(
    key: keyof MetronomeRandomnessParams,
    value: number
  ): void {
    const current = metronomeRandomnessParams[key];
    let next = Number.isFinite(value) ? value : current;
    const field = metronomeFields.find((item) => item.key === key);
    if (field?.min !== undefined) next = Math.max(field.min, next);
    if (field?.max !== undefined) next = Math.min(field.max, next);
    metronomeRandomnessParams = {
      ...metronomeRandomnessParams,
      [key]: next,
    };
  }

  function renderMetronomeTable(): void {
    metronomeBody.replaceChildren();
    metronomeFields.forEach((field) => {
      const row = document.createElement("tr");

      const keyCell = document.createElement("td");
      keyCell.textContent = field.label;

      const valueCell = document.createElement("td");
      const input = document.createElement("input");
      input.type = "number";
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      if (field.step !== undefined) input.step = String(field.step);
      input.value = String(metronomeRandomnessParams[field.key]);
      input.setAttribute("aria-label", `Metronome randomness ${field.label}`);
      input.addEventListener("change", () => {
        const parsed = Number.parseFloat(input.value);
        if (!Number.isFinite(parsed)) return;
        setMetronomeParam(field.key, parsed);
        renderMetronomeTable();
      });
      valueCell.appendChild(input);

      row.appendChild(keyCell);
      row.appendChild(valueCell);
      metronomeBody.appendChild(row);
    });
  }

  function renderMappingTable(): void {
    const mapping = getSeigaihaDetuneMapping();
    tableBody.replaceChildren();
    mapping.forEach((point, index) => {
      const row = document.createElement("tr");

      const centsCell = document.createElement("td");
      const centsInput = document.createElement("input");
      centsInput.type = "number";
      centsInput.step = "0.1";
      centsInput.min = "0";
      centsInput.value = point.cents.toString();
      centsInput.setAttribute("aria-label", `Mapping abs cents row ${index + 1}`);
      centsInput.addEventListener("change", () => {
        const next = Number.parseFloat(centsInput.value);
        if (!Number.isFinite(next)) return;
        const current = getSeigaihaDetuneMapping();
        const updated = current[index];
        if (!updated) return;
        updated.cents = Math.max(0, next);
        setSeigaihaDetuneMapping(current);
        renderMappingTable();
      });
      centsCell.appendChild(centsInput);

      const randomnessCell = document.createElement("td");
      const randomnessInput = document.createElement("input");
      randomnessInput.type = "number";
      randomnessInput.step = "0.01";
      randomnessInput.min = "0";
      randomnessInput.max = "1";
      randomnessInput.value = point.randomness.toString();
      randomnessInput.setAttribute(
        "aria-label",
        `Mapping randomness row ${index + 1}`
      );
      randomnessInput.addEventListener("change", () => {
        const next = Number.parseFloat(randomnessInput.value);
        if (!Number.isFinite(next)) return;
        const current = getSeigaihaDetuneMapping();
        const updated = current[index];
        if (!updated) return;
        updated.randomness = Math.max(0, Math.min(1, next));
        setSeigaihaDetuneMapping(current);
        renderMappingTable();
      });
      randomnessCell.appendChild(randomnessInput);

      row.appendChild(centsCell);
      row.appendChild(randomnessCell);
      tableBody.appendChild(row);
    });
  }

  overrideToggle.addEventListener("change", () => {
    const enabled = overrideToggle.checked;
    setSeigaihaDebugOverrideEnabled(enabled);
    slider.disabled = !enabled;
    if (enabled) {
      const nextValue = Number.parseFloat(slider.value);
      if (Number.isFinite(nextValue)) {
        setSeigaihaRandomness(nextValue);
      }
    }
    value.textContent = getSeigaihaRandomness().toFixed(2);
  });

  slider.addEventListener("input", () => {
    if (!overrideToggle.checked) return;
    const nextValue = Number.parseFloat(slider.value);
    if (!Number.isFinite(nextValue)) return;
    setSeigaihaRandomness(nextValue);
    value.textContent = getSeigaihaRandomness().toFixed(2);
  });

  tunerSection.appendChild(overrideRow);
  tunerSection.appendChild(slider);
  tunerSection.appendChild(value);
  tunerSection.appendChild(fps);
  tunerSection.appendChild(smoothingRow);
  tunerSection.appendChild(tableLabel);
  tunerSection.appendChild(table);

  metronomeSection.appendChild(metronomeLabel);
  metronomeSection.appendChild(metronomeTable);

  drumSection.appendChild(drumLabel);
  drumSection.appendChild(drumTargetRow);

  panel.appendChild(title);
  panel.appendChild(tunerSection);
  panel.appendChild(metronomeSection);
  panel.appendChild(drumSection);
  document.body.appendChild(panel);

  syncSeigaihaDebugModeVisibility = () => {
    tunerSection.style.display = activeModeId === "tuner" ? "" : "none";
    metronomeSection.style.display = activeModeId === "metronome" ? "" : "none";
    drumSection.style.display = activeModeId === "drum-machine" ? "" : "none";
  };

  renderMappingTable();
  renderMetronomeTable();
  syncSeigaihaDebugModeVisibility();
  let lastSampleAt = performance.now();
  let lastRenderCount = getSeigaihaRenderStats().renderCount;
  window.setInterval(() => {
    value.textContent = getSeigaihaRandomness().toFixed(2);
    const now = performance.now();
    const stats = getSeigaihaRenderStats();
    const dt = Math.max(1, now - lastSampleAt);
    const deltaRenders = Math.max(0, stats.renderCount - lastRenderCount);
    const effectiveFps = (deltaRenders * 1000) / dt;
    fps.textContent = `FPS ${effectiveFps.toFixed(1)}`;
    lastSampleAt = now;
    lastRenderCount = stats.renderCount;
  }, 120);
}

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
  document.body.setAttribute("data-active-mode", id);
  syncSeigaihaDebugModeVisibility?.();
}

function getModeByOffset(offset: number): ModeId | null {
  const order = MODE_REGISTRY.map((mode) => mode.id);
  const currentIndex = order.indexOf(activeModeId);
  if (currentIndex === -1) return null;
  const nextIndex = (currentIndex + offset + order.length) % order.length;
  const nextMode = order[nextIndex];
  return nextMode ?? null;
}

function requestModeSwitchFromSwipe(nextMode: ModeId): void {
  // Intentionally non-blocking: touchend should finish immediately,
  // while switchMode handles async lifecycle and error reporting.
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
        const nextMode = getModeByOffset(dx < 0 ? 1 : -1);
        if (!nextMode) return;
        requestModeSwitchFromSwipe(nextMode);
        return;
      }

      const width = modeStageEl.getBoundingClientRect().width;
      const shouldCommit = Math.abs(swipeDx) > width * 0.22;
      await animateSwipe(shouldCommit);
      const nextMode = shouldCommit ? swipeTargetMode : null;
      clearSwipeState();
      if (nextMode) {
        requestModeSwitchFromSwipe(nextMode);
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
  installSeigaihaBackground();
  bindSeigaihaDebugControl();

  activeModeId = resolveInitialModeId();
  updateCarouselState();
  setActiveScreen(activeModeId);

  const initialMode = MODE_REGISTRY.find((mode) => mode.id === activeModeId);
  if (initialMode?.onEnter) {
    await initialMode.onEnter();
  }
});
