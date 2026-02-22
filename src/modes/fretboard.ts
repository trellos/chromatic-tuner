import type { ModeDefinition } from "./types.js";
import {
  getFretboardDots,
  normalizeChordType,
  type AnnotationType,
  type CharacteristicType,
  type DisplayType,
  type FretboardState,
  type ScaleType,
} from "./fretboard-logic.js";

const SCALE_OPTIONS: Array<{ value: ScaleType; label: string }> = [
  { value: "major", label: "Major" },
  { value: "minor", label: "Minor" },
  { value: "minor-pentatonic", label: "Minor Pentatonic" },
  { value: "major-pentatonic", label: "Major Pentatonic" },
  { value: "blues", label: "Blues" },
];

const CHORD_OPTIONS: Array<{ value: CharacteristicType; label: string }> = [
  { value: "major", label: "Major" },
  { value: "minor", label: "Minor" },
  { value: "power", label: "Power" },
  { value: "triad", label: "Triad" },
  { value: "seventh", label: "Seventh" },
  { value: "augmented", label: "Augmented" },
  { value: "suspended-second", label: "Suspended Second" },
  { value: "suspended-fourth", label: "Suspended Fourth" },
  { value: "ninth", label: "Ninth" },
];

const DEFAULT_STATE: FretboardState = {
  root: "C",
  display: "scale",
  characteristic: "major",
  annotation: "notes",
};

export function createFretboardMode(): ModeDefinition {
  const modeEl = document.querySelector<HTMLElement>('.mode-screen[data-mode="fretboard"]');
  const rootButtons = modeEl?.querySelectorAll<HTMLButtonElement>('[data-fretboard-root]') ?? [];
  const displayButtons = modeEl?.querySelectorAll<HTMLButtonElement>('[data-fretboard-display]') ?? [];
  const characteristicSelect = modeEl?.querySelector<HTMLSelectElement>('#fretboard-characteristic') ?? null;
  const annotationButtons = modeEl?.querySelectorAll<HTMLButtonElement>('[data-fretboard-annotation]') ?? [];
  const dotsLayer = modeEl?.querySelector<HTMLElement>('.fretboard-dots') ?? null;
  const openIndicatorsLayer =
    modeEl?.querySelector<HTMLElement>('.fretboard-open-indicators') ?? null;

  let state: FretboardState = { ...DEFAULT_STATE };
  let uiAbort: AbortController | null = null;

  const setCharacteristicOptions = () => {
    if (!characteristicSelect) return;
    const options = state.display === "scale" ? SCALE_OPTIONS : CHORD_OPTIONS;
    const previous = String(state.characteristic);

    characteristicSelect.innerHTML = "";
    for (const option of options) {
      const next = document.createElement("option");
      next.value = option.value;
      next.textContent = option.label;
      characteristicSelect.append(next);
    }

    const hasPrevious = options.some((option) => option.value === previous);
    const fallback = options[0]?.value ?? "minor";
    state.characteristic = hasPrevious ? (previous as CharacteristicType) : fallback;
    characteristicSelect.value = state.characteristic;
  };

  const renderControls = () => {
    rootButtons.forEach((button) => {
      const isActive = button.dataset.fretboardRoot === state.root;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    displayButtons.forEach((button) => {
      const isActive = button.dataset.fretboardDisplay === state.display;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    annotationButtons.forEach((button) => {
      const isActive = button.dataset.fretboardAnnotation === state.annotation;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  };

  const renderDots = () => {
    if (!dotsLayer || !openIndicatorsLayer) return;
    const dots = getFretboardDots(state);
    dotsLayer.innerHTML = "";
    openIndicatorsLayer.innerHTML = "";

    for (const dot of dots) {
      if (dot.fret === 0) {
        const openIndicator = document.createElement("span");
        openIndicator.className = "fretboard-open-indicator";
        openIndicator.style.setProperty("--string-index", String(dot.stringIndex));
        openIndicatorsLayer.append(openIndicator);
        continue;
      }

      const marker = document.createElement("span");
      marker.className = "fretboard-dot";
      const isRoot = dot.degree === "1";
      marker.classList.toggle("is-root", isRoot);
      marker.style.setProperty("--string-index", String(dot.stringIndex));
      marker.style.setProperty("--fret-index", String(dot.fret));
      marker.dataset.note = dot.note;
      marker.dataset.degree = dot.degree;
      marker.dataset.fret = String(dot.fret);
      marker.dataset.root = isRoot ? "1" : "0";
      marker.textContent = state.annotation === "notes" ? dot.note : dot.degree;
      dotsLayer.append(marker);
    }
  };

  const render = () => {
    setCharacteristicOptions();
    renderControls();
    renderDots();
  };

  const enterMode = () => {
    if (!modeEl || uiAbort) return;
    uiAbort = new AbortController();
    const signal = uiAbort.signal;

    rootButtons.forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const root = button.dataset.fretboardRoot;
          if (!root) return;
          state.root = root as FretboardState["root"];
          render();
        },
        { signal }
      );
    });

    displayButtons.forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const nextDisplay = button.dataset.fretboardDisplay as DisplayType | undefined;
          if (!nextDisplay || nextDisplay === state.display) return;
          state.display = nextDisplay;
          render();
        },
        { signal }
      );
    });

    characteristicSelect?.addEventListener(
      "change",
      () => {
        const nextRaw = characteristicSelect.value;
        if (state.display === "chord") {
          state.characteristic = normalizeChordType(nextRaw) ?? "major";
        } else {
          state.characteristic = (nextRaw as ScaleType) ?? "minor";
        }
        render();
      },
      { signal }
    );

    annotationButtons.forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const annotation = button.dataset.fretboardAnnotation as AnnotationType | undefined;
          if (!annotation) return;
          state.annotation = annotation;
          renderControls();
          renderDots();
        },
        { signal }
      );
    });

    render();
  };

  const exitMode = () => {
    uiAbort?.abort();
    uiAbort = null;
  };

  return {
    id: "fretboard",
    title: "Fretboard",
    icon: "FB",
    preserveState: true,
    onEnter: enterMode,
    onExit: exitMode,
  };
}
