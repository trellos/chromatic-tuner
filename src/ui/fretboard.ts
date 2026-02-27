import {
  getFretboardDots,
  getFretboardMidiAtPosition,
  normalizeKeyModeType,
  normalizeChordType,
  type AnnotationType,
  type CharacteristicType,
  type DisplayType,
  type FretboardPlaybackTarget,
  type FretboardState,
  type KeyModeType,
  type ScaleType,
} from "../fretboard-logic.js";

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

const KEY_MODE_OPTIONS: Array<{ value: KeyModeType; label: string }> = [
  { value: "ionian-major", label: "Ionian (Major)" },
  { value: "dorian", label: "Dorian" },
  { value: "phrygian", label: "Phrygian" },
  { value: "lydian", label: "Lydian (Major)" },
  { value: "mixolydian", label: "Mixolydian" },
  { value: "aeolian-minor", label: "Aeolian (Minor)" },
  { value: "locrian", label: "Locrian" },
];

export type FretboardUiOptions = {
  initialState: FretboardState;
  showControls?: boolean;
  controlsHidden?: boolean;
  onStateChange?: (nextState: FretboardState) => void;
  onPlayPress?: () => void;
  onFretPress?: (event: { midi: number; stringIndex: number; fret: number }) => void;
};

export type FretboardUi = {
  enter: () => void;
  exit: () => void;
  render: (nextState: FretboardState) => void;
  pulseTargets: (targets: FretboardPlaybackTarget[], durationMs?: number) => void;
  setLooperElement: (looperEl: HTMLElement | null) => void;
};

export function createFretboardUi(rootEl: HTMLElement, options: FretboardUiOptions): FretboardUi {
  const rootButtons = rootEl.querySelectorAll<HTMLButtonElement>("[data-fretboard-root]");
  const displayButtons = rootEl.querySelectorAll<HTMLButtonElement>("[data-fretboard-display]");
  const characteristicSelect = rootEl.querySelector<HTMLSelectElement>("#fretboard-characteristic");
  const annotationButtons = rootEl.querySelectorAll<HTMLButtonElement>("[data-fretboard-annotation]");
  const dotsLayer = rootEl.querySelector<HTMLElement>(".fretboard-dots");
  const openIndicatorsLayer = rootEl.querySelector<HTMLElement>(".fretboard-open-indicators");
  const playButton = rootEl.querySelector<HTMLButtonElement>("[data-fretboard-play]");
  const hideButton = rootEl.querySelector<HTMLButtonElement>("[data-fretboard-hide]");
  const hiddenSummaryButton = rootEl.querySelector<HTMLButtonElement>("[data-fretboard-summary]");
  const hideableSections = rootEl.querySelectorAll<HTMLElement>("[data-fretboard-hideable]");
  const controls = rootEl.querySelector<HTMLElement>(".fretboard-controls");
  const layout = rootEl.querySelector<HTMLElement>(".fretboard-layout");
  let looperSlot = rootEl.querySelector<HTMLElement>(".fretboard-looper-slot");
  if (!looperSlot && layout) {
    looperSlot = document.createElement("div");
    looperSlot.className = "fretboard-looper-slot";
    looperSlot.setAttribute("aria-label", "Fretboard looper host");
    looperSlot.hidden = true;
    layout.appendChild(looperSlot);
  }

  let uiAbort: AbortController | null = null;
  let state: FretboardState = { ...options.initialState };
  let controlsHidden = options.controlsHidden ?? false;
  const markerPulseTimeouts = new WeakMap<HTMLElement, number>();

  const showControls = options.showControls ?? true;
  controls?.toggleAttribute("hidden", !showControls);

  const emitState = () => {
    options.onStateChange?.({ ...state });
  };

  const setCharacteristicOptions = (): void => {
    if (!characteristicSelect) return;
    const entries =
      state.display === "scale"
        ? SCALE_OPTIONS
        : state.display === "chord"
          ? CHORD_OPTIONS
          : KEY_MODE_OPTIONS;
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

  const getCharacteristicLabel = (value: CharacteristicType): string => {
    const entries =
      state.display === "scale"
        ? SCALE_OPTIONS
        : state.display === "chord"
          ? CHORD_OPTIONS
          : KEY_MODE_OPTIONS;
    return entries.find((entry) => entry.value === value)?.label ?? "Major";
  };

  const applyControlVisibility = (): void => {
    hideableSections.forEach((section) => {
      section.toggleAttribute("hidden", controlsHidden);
      // Ensure hidden controls are also excluded by selectors like `button:not([hidden])`.
      section.querySelectorAll<HTMLElement>("button, select, label").forEach((el) => {
        el.toggleAttribute("hidden", controlsHidden);
      });
    });
    hiddenSummaryButton?.toggleAttribute("hidden", !controlsHidden);
    hideButton?.classList.toggle("is-active", controlsHidden);
    if (hideButton) {
      hideButton.textContent = controlsHidden ? "SHOW" : "HIDE";
      hideButton.setAttribute("aria-pressed", String(controlsHidden));
    }
    rootEl.classList.toggle("fretboard-controls-hidden", controlsHidden);
    layout?.classList.toggle("fretboard-controls-hidden", controlsHidden);
    controls?.toggleAttribute("data-controls-hidden", controlsHidden);
  };

  const setSummaryText = (): void => {
    if (!hiddenSummaryButton) return;
    hiddenSummaryButton.textContent = `${state.root} ${getCharacteristicLabel(state.characteristic)}`;
  };

  const clearMarkerPulse = (marker: HTMLElement): void => {
    const timeoutId = markerPulseTimeouts.get(marker);
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      markerPulseTimeouts.delete(marker);
    }
    marker.classList.remove("is-pulsing", "is-pulsing-root");
  };

  const triggerMarkerPulse = (marker: HTMLElement, isRoot: boolean, durationMs: number): void => {
    clearMarkerPulse(marker);
    void marker.getBoundingClientRect(); // Force reflow so the browser registers class removal before re-adding, restarting the CSS animation.
    marker.classList.add("is-pulsing");
    if (isRoot) {
      marker.classList.add("is-pulsing-root");
    }

    const pulse = document.createElement("span");
    pulse.className = "fretboard-dot-pulse";
    if (isRoot) pulse.classList.add("is-root");
    marker.appendChild(pulse);
    pulse.addEventListener(
      "animationend",
      () => {
        pulse.remove();
      },
      { once: true }
    );

    const timeoutId = window.setTimeout(() => {
      marker.classList.remove("is-pulsing", "is-pulsing-root");
      markerPulseTimeouts.delete(marker);
    }, Math.max(180, durationMs));
    markerPulseTimeouts.set(marker, timeoutId);
  };

  const resolveTargetElements = (target: FretboardPlaybackTarget): HTMLElement[] => {
    const selector = [
      `.fretboard-dot[data-midi="${target.midi}"][data-string-index="${target.stringIndex}"]`,
      `.fretboard-open-indicator[data-midi="${target.midi}"][data-string-index="${target.stringIndex}"]`,
    ].join(", ");
    const exactMatches = rootEl.querySelectorAll<HTMLElement>(selector);
    if (exactMatches.length > 0) return Array.from(exactMatches);
    const fallbackSelector = [
      `.fretboard-dot[data-midi="${target.midi}"]`,
      `.fretboard-open-indicator[data-midi="${target.midi}"]`,
    ].join(", ");
    return Array.from(rootEl.querySelectorAll<HTMLElement>(fallbackSelector));
  };

  const pulseTargets = (targets: FretboardPlaybackTarget[], durationMs = 420): void => {
    targets.forEach((target) => {
      const elements = resolveTargetElements(target);
      elements.forEach((marker) => {
        triggerMarkerPulse(marker, Boolean(target.isRoot), durationMs);
      });
    });
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
    setSummaryText();
    applyControlVisibility();
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
        if (state.display === "chord") {
          state.characteristic = normalizeChordType(nextRaw) ?? "major";
        } else if (state.display === "key") {
          state.characteristic = normalizeKeyModeType(nextRaw) ?? "ionian-major";
        } else {
          state.characteristic = (nextRaw as ScaleType) ?? "major";
        }
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
    hideButton?.addEventListener(
      "click",
      () => {
        controlsHidden = !controlsHidden;
        applyControlVisibility();
      },
      { signal }
    );
    hiddenSummaryButton?.addEventListener(
      "click",
      () => {
        controlsHidden = false;
        applyControlVisibility();
      },
      { signal }
    );
    dotsLayer?.addEventListener("click", (event) => onMarkerPress(event.target), { signal });
    openIndicatorsLayer?.addEventListener("click", (event) => onMarkerPress(event.target), { signal });

    render(state);
  };

  const exit = () => {
    uiAbort?.abort();
    uiAbort = null;
    const lingering = rootEl.querySelectorAll<HTMLElement>(
      ".fretboard-dot.is-pulsing, .fretboard-open-indicator.is-pulsing"
    );
    lingering.forEach((marker) => clearMarkerPulse(marker));
    rootEl.querySelectorAll(".fretboard-dot-pulse").forEach((pulse) => pulse.remove());
  };

  const setLooperElement = (looperEl: HTMLElement | null): void => {
    if (!looperSlot) return;
    looperSlot.replaceChildren();
    if (looperEl) {
      looperSlot.hidden = false;
      looperSlot.appendChild(looperEl);
      return;
    }
    looperSlot.hidden = true;
  };

  return { enter, exit, render, pulseTargets, setLooperElement };
}
