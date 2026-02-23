import {
  getFretboardDots,
  getFretboardMidiAtPosition,
  normalizeChordType,
  type AnnotationType,
  type CharacteristicType,
  type DisplayType,
  type FretboardState,
  type ScaleType,
} from "../modes/fretboard-logic.js";

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

export type FretboardUiOptions = {
  initialState: FretboardState;
  showControls?: boolean;
  onStateChange?: (nextState: FretboardState) => void;
  onPlayPress?: () => void;
  onFretPress?: (event: { midi: number; stringIndex: number; fret: number }) => void;
};

export type FretboardUi = {
  enter: () => void;
  exit: () => void;
  render: (nextState: FretboardState) => void;
};

export function createFretboardUi(rootEl: HTMLElement, options: FretboardUiOptions): FretboardUi {
  const rootButtons = rootEl.querySelectorAll<HTMLButtonElement>("[data-fretboard-root]");
  const displayButtons = rootEl.querySelectorAll<HTMLButtonElement>("[data-fretboard-display]");
  const characteristicSelect = rootEl.querySelector<HTMLSelectElement>("#fretboard-characteristic");
  const annotationButtons = rootEl.querySelectorAll<HTMLButtonElement>("[data-fretboard-annotation]");
  const dotsLayer = rootEl.querySelector<HTMLElement>(".fretboard-dots");
  const openIndicatorsLayer = rootEl.querySelector<HTMLElement>(".fretboard-open-indicators");
  const playButton = rootEl.querySelector<HTMLButtonElement>("[data-fretboard-play]");
  const controls = rootEl.querySelector<HTMLElement>(".fretboard-controls");

  let uiAbort: AbortController | null = null;
  let state: FretboardState = { ...options.initialState };

  const showControls = options.showControls ?? true;
  controls?.toggleAttribute("hidden", !showControls);

  const emitState = () => {
    options.onStateChange?.({ ...state });
  };

  const setCharacteristicOptions = (): void => {
    if (!characteristicSelect) return;
    const entries = state.display === "scale" ? SCALE_OPTIONS : CHORD_OPTIONS;
    const previous = String(state.characteristic);

    characteristicSelect.innerHTML = "";
    for (const option of entries) {
      const next = document.createElement("option");
      next.value = option.value;
      next.textContent = option.label;
      characteristicSelect.append(next);
    }

    const hasPrevious = entries.some((entry) => entry.value === previous);
    const fallback = entries[0]?.value ?? "major";
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
      const isRoot = dot.degree === "1";
      if (dot.fret === 0) {
        const openIndicator = document.createElement("span");
        openIndicator.className = "fretboard-open-indicator";
        openIndicator.classList.toggle("is-root", isRoot);
        openIndicator.style.setProperty("--string-index", String(dot.stringIndex));
        openIndicator.dataset.root = isRoot ? "1" : "0";
        openIndicator.dataset.note = dot.note;
        openIndicator.dataset.degree = dot.degree;
        openIndicator.dataset.stringIndex = String(dot.stringIndex);
        openIndicator.dataset.fret = "0";
        openIndicator.dataset.midi = String(dot.midi ?? getFretboardMidiAtPosition(dot.stringIndex, dot.fret));
        openIndicatorsLayer.append(openIndicator);
        continue;
      }

      const marker = document.createElement("span");
      marker.className = "fretboard-dot";
      marker.classList.toggle("is-root", isRoot);
      marker.style.setProperty("--string-index", String(dot.stringIndex));
      marker.style.setProperty("--fret-index", String(dot.fret));
      marker.dataset.note = dot.note;
      marker.dataset.degree = dot.degree;
      marker.dataset.stringIndex = String(dot.stringIndex);
      marker.dataset.fret = String(dot.fret);
      marker.dataset.root = isRoot ? "1" : "0";
      marker.dataset.midi = String(dot.midi ?? getFretboardMidiAtPosition(dot.stringIndex, dot.fret));
      marker.textContent = state.annotation === "notes" ? dot.note : dot.degree;
      dotsLayer.append(marker);
    }
  };

  const render = (nextState: FretboardState) => {
    state = { ...nextState };
    setCharacteristicOptions();
    renderControls();
    renderDots();
  };

  const onMarkerPress = (target: EventTarget | null) => {
    const marker = (target as HTMLElement | null)?.closest<HTMLElement>(
      ".fretboard-dot, .fretboard-open-indicator"
    );
    if (!marker) return;
    const midi = Number.parseInt(marker.dataset.midi ?? "", 10);
    const stringIndex = Number.parseInt(marker.dataset.stringIndex ?? "", 10);
    const fret = Number.parseInt(marker.dataset.fret ?? "", 10);
    if (!Number.isFinite(midi) || !Number.isFinite(stringIndex) || !Number.isFinite(fret)) return;
    options.onFretPress?.({ midi, stringIndex, fret });
  };

  const enter = () => {
    if (uiAbort) return;
    uiAbort = new AbortController();
    const signal = uiAbort.signal;

    rootButtons.forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const root = button.dataset.fretboardRoot;
          if (!root) return;
          state.root = root as FretboardState["root"];
          render(state);
          emitState();
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
          render(state);
          emitState();
        },
        { signal }
      );
    });

    characteristicSelect?.addEventListener(
      "change",
      () => {
        const nextRaw = characteristicSelect.value;
        state.characteristic =
          state.display === "chord"
            ? (normalizeChordType(nextRaw) ?? "major")
            : ((nextRaw as ScaleType) ?? "major");
        render(state);
        emitState();
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
          emitState();
        },
        { signal }
      );
    });

    playButton?.addEventListener("click", () => options.onPlayPress?.(), { signal });
    dotsLayer?.addEventListener("click", (event) => onMarkerPress(event.target), { signal });
    openIndicatorsLayer?.addEventListener("click", (event) => onMarkerPress(event.target), { signal });

    render(state);
  };

  const exit = () => {
    uiAbort?.abort();
    uiAbort = null;
  };

  return { enter, exit, render };
}
