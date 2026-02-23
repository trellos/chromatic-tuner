export type CircleQuality = "minor" | "diminished";

export type CircleChordSpec = {
  label: string;
  rootMidi: number;
  quality: CircleQuality;
};

export type CircleSelection = {
  primaryLabel: string;
  primaryMidi: number;
  secondaryChords: CircleChordSpec[];
  diminishedChord: CircleChordSpec;
};

export type CircleOfFifthsUiOptions = {
  onPrimaryTap?: (selection: CircleSelection) => void;
  onSecondaryTap?: (chord: CircleChordSpec) => void;
  onOuterTap?: (note: CircleNoteTap) => void;
  onOuterDoubleTap?: (note: CircleNoteTap) => void;
  onNoteBarTap?: (note: { label: string; midi: number }) => void;
  onBackgroundTap?: () => void;
};

export type CircleOfFifthsUi = {
  setPrimaryByLabel: (label: string | null) => void;
  setPrimaryByMidi: (midi: number | null) => void;
  setTuningCents: (cents: number | null) => void;
  setChordMode: (enabled: boolean) => void;
  setMinorMode: (enabled: boolean) => void;
  pulseNote: (midi: number, durationMs?: number) => void;
  pulseChord: (midis: number[], durationMs?: number) => void;
  destroy: () => void;
};

type CircleNote = {
  label: string;
  semitone: number;
};

export type CircleNoteTap = {
  index: number;
  label: string;
  midi: number;
  isPrimary: boolean;
};

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEWBOX_SIZE = 1000;
const CENTER = VIEWBOX_SIZE / 2;

const OUTER_RADIUS = 450;
const OUTER_INNER_RADIUS = 320;
const SECONDARY_OUTER_RADIUS = 314;
const SECONDARY_INNER_RADIUS = 232;
const DIM_OUTER_RADIUS = 228;
const DIM_INNER_RADIUS = 176;

const OUTER_STEP_DEG = 30;
const OUTER_WEDGE_DEG = 25;
const SECONDARY_WEDGE_DEG = 24;
const DIM_WEDGE_DEG = 24;
const SECONDARY_CENTERS = [-30, 0, 30] as const;
const SECONDARY_INTERVALS = [2, 4, 9] as const; // II, III, VI
const SECONDARY_DEGREE_LABELS = ["ii", "iii", "vi"] as const;
const DIM_DEGREE_LABEL = "vii°";
const SECONDARY_DEGREE_KEYS = ["ii", "iii", "vi"] as const;
const DIM_DEGREE_KEY = "vii";
const WEDGE_PULSE_DURATION_MS = 640;
const OUTER_CLICK_DELAY_MS = 360;
const MODE_BANNER_LINE_OFFSETS = [-2, -1, 0, 1, 2] as const;
const MODE_BANNER_LINE_GAP = 72;
let circleModeBannerSeq = 0;
const NOTE_BAR_ORDER_SEMITONES = [9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8] as const; // A..G#
const NOTE_BAR_LABELS = ["A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab"] as const;

const OUTER_NOTES: CircleNote[] = [
  { label: "C", semitone: 0 },
  { label: "G", semitone: 7 },
  { label: "D", semitone: 2 },
  { label: "A", semitone: 9 },
  { label: "E", semitone: 4 },
  { label: "B", semitone: 11 },
  { label: "F#", semitone: 6 },
  { label: "Db", semitone: 1 },
  { label: "Ab", semitone: 8 },
  { label: "Eb", semitone: 3 },
  { label: "Bb", semitone: 10 },
  { label: "F", semitone: 5 },
];

const SEMITONE_TO_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SEMITONE_TO_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function normalizeSignedDegrees(value: number): number {
  return ((value + 540) % 360) - 180;
}

function wrapSemitone(value: number): number {
  return ((value % 12) + 12) % 12;
}

function keyPrefersFlats(label: string): boolean {
  return label.includes("b") || label === "F";
}

function noteLabelFromSemitone(semitone: number, preferFlats: boolean): string {
  const idx = wrapSemitone(semitone);
  return preferFlats ? (SEMITONE_TO_FLAT[idx] ?? "C") : (SEMITONE_TO_SHARP[idx] ?? "C");
}

function chordLabel(root: string, quality: CircleQuality): string {
  return quality === "diminished" ? `${root}°` : `${root}m`;
}

type CircleDegreeToken = "I" | "ii" | "iii" | "IV" | "V" | "vi" | "vii°";
type CircleDegreeKey = "i" | "ii" | "iii" | "iv" | "v" | "vi" | "vii";

function degreeTokenForMajorInterval(interval: number): CircleDegreeToken | null {
  switch (wrapSemitone(interval)) {
    case 0:
      return "I";
    case 2:
      return "ii";
    case 4:
      return "iii";
    case 5:
      return "IV";
    case 7:
      return "V";
    case 9:
      return "vi";
    case 11:
      return "vii°";
    default:
      return null;
  }
}

function degreeKeyFromToken(token: CircleDegreeToken): CircleDegreeKey {
  switch (token) {
    case "I":
      return "i";
    case "ii":
      return "ii";
    case "iii":
      return "iii";
    case "IV":
      return "iv";
    case "V":
      return "v";
    case "vi":
      return "vi";
    case "vii°":
      return "vii";
  }
}

function minorTokenFromMajorToken(token: CircleDegreeToken): string {
  switch (token) {
    case "I":
      return "III";
    case "ii":
      return "iv";
    case "iii":
      return "v";
    case "IV":
      return "VI";
    case "V":
      return "VII";
    case "vi":
      return "i";
    case "vii°":
      return "ii°";
  }
}

function innerDegreeLabelForMode(label: string, minorMode: boolean): string {
  if (!minorMode) return label;
  switch (label) {
    case "ii":
      return "iv";
    case "iii":
      return "v";
    case "vi":
      return "i";
    case "vii°":
      return "ii°";
    default:
      return label;
  }
}

function outerDegreeLabelForMode(token: CircleDegreeToken | null, minorMode: boolean): string {
  if (!token) return "";
  if (!minorMode) return token === "I" || token === "IV" || token === "V" ? token : "";
  if (token === "I" || token === "IV" || token === "V") return minorTokenFromMajorToken(token);
  return "";
}

function setTextClassForFit(target: SVGTextElement, baseClass: string, text: string): void {
  const fitClass = text.length >= 5 ? `${baseClass} ${baseClass}--tight` : baseClass;
  target.setAttribute("class", fitClass);
}

function midiFromSemitoneNearC4(semitone: number): number {
  return 60 + wrapSemitone(semitone);
}

function polarPoint(radius: number, angleDeg: number): { x: number; y: number } {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(angleRad),
    y: CENTER + radius * Math.sin(angleRad),
  };
}

function describeAnnularSector(
  innerRadius: number,
  outerRadius: number,
  centerDeg: number,
  wedgeDeg: number
): string {
  const startDeg = centerDeg - wedgeDeg / 2;
  const endDeg = centerDeg + wedgeDeg / 2;
  const sweep = endDeg - startDeg;
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const outerStart = polarPoint(outerRadius, startDeg);
  const outerEnd = polarPoint(outerRadius, endDeg);
  const innerEnd = polarPoint(innerRadius, endDeg);
  const innerStart = polarPoint(innerRadius, startDeg);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function getSelectionFromPrimary(primaryIndex: number): CircleSelection {
  const primary = OUTER_NOTES[primaryIndex] ?? OUTER_NOTES[0]!;
  const preferFlats = keyPrefersFlats(primary.label);

  const secondaryChords: CircleChordSpec[] = SECONDARY_INTERVALS.map((offset) => {
    const semitone = wrapSemitone(primary.semitone + offset);
    const root = noteLabelFromSemitone(semitone, preferFlats);
    return {
      label: chordLabel(root, "minor"),
      rootMidi: midiFromSemitoneNearC4(semitone),
      quality: "minor",
    };
  });

  const viiSemitone = wrapSemitone(primary.semitone + 11);
  const viiRoot = noteLabelFromSemitone(viiSemitone, preferFlats);
  const diminishedChord: CircleChordSpec = {
    label: chordLabel(viiRoot, "diminished"),
    rootMidi: midiFromSemitoneNearC4(viiSemitone),
    quality: "diminished",
  };

  return {
    primaryLabel: primary.label,
    primaryMidi: midiFromSemitoneNearC4(primary.semitone),
    secondaryChords,
    diminishedChord,
  };
}

export function getCircleChordMidis(chord: CircleChordSpec): number[] {
  const root = normalizeChordRootMidi(chord.rootMidi);
  if (chord.quality === "diminished") {
    return [root, root + 3, root + 6];
  }
  return [root, root + 3, root + 7];
}

export function getCircleMajorChordMidis(rootMidi: number): number[] {
  const root = normalizeChordRootMidi(rootMidi);
  return [root, root + 4, root + 7];
}

function normalizeChordRootMidi(rootMidi: number): number {
  if (!Number.isFinite(rootMidi)) return 60;
  let root = Math.round(rootMidi);
  while (root < 48) root += 12;
  while (root > 72) root -= 12;
  return root;
}

function createSvgEl<T extends keyof SVGElementTagNameMap>(
  tag: T,
  className?: string
): SVGElementTagNameMap[T] {
  const element = document.createElementNS(SVG_NS, tag);
  if (className) element.setAttribute("class", className);
  return element;
}

function appendRadialHintGradient(
  defs: SVGDefsElement,
  id: string,
  color: string,
  midOpacity: string
): void {
  const gradient = createSvgEl("radialGradient");
  gradient.setAttribute("id", id);
  gradient.setAttribute("cx", String(CENTER));
  gradient.setAttribute("cy", String(CENTER));
  gradient.setAttribute("r", String(OUTER_RADIUS));
  gradient.setAttribute("gradientUnits", "userSpaceOnUse");

  const stops = [
    { offset: "0%", opacity: "0" },
    { offset: "67%", opacity: "0" },
    { offset: "74%", opacity: midOpacity },
    { offset: "100%", opacity: "0" },
  ] as const;

  stops.forEach(({ offset, opacity }) => {
    const stop = createSvgEl("stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", color);
    stop.setAttribute("stop-opacity", opacity);
    gradient.appendChild(stop);
  });
  defs.appendChild(gradient);
}

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildTessellatedIndicatorText(token: string, repeats: number): string {
  let output = "";
  for (let i = 0; i < repeats; i += 1) {
    output += `${token}${" ".repeat(randomIntInclusive(2, 6))}`;
  }
  return output;
}

export function createCircleOfFifthsUi(
  container: HTMLElement,
  options: CircleOfFifthsUiOptions = {}
): CircleOfFifthsUi {
  // Render tree:
  // 1) outer wedges (always visible)
  // 2) mode banner (clipped to center disk)
  // 3) detail rings (rotating ii/iii/vi and vii° layer)
  // 4) pulse overlays
  const root = document.createElement("section");
  root.className = "cof";

  const svg = createSvgEl("svg", "cof-svg");
  svg.setAttribute("viewBox", `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`);
  svg.setAttribute("aria-label", "Circle of Fifths");

  const instanceId = circleModeBannerSeq++;
  const defs = createSvgEl("defs");
  const outerHintThirdId = `cof-outer-hint-third-${instanceId}`;
  const outerHintDimId = `cof-outer-hint-dim-${instanceId}`;
  appendRadialHintGradient(defs, outerHintThirdId, "rgb(124, 58, 237)", "0.5");
  appendRadialHintGradient(defs, outerHintDimId, "rgb(255, 158, 0)", "0.44");

  const clipPath = createSvgEl("clipPath");
  const clipId = `cof-mode-clip-${instanceId}`;
  clipPath.setAttribute("id", clipId);
  const clipPathShape = createSvgEl("circle");
  clipPathShape.setAttribute("cx", String(CENTER));
  clipPathShape.setAttribute("cy", String(CENTER));
  clipPathShape.setAttribute("r", String(OUTER_INNER_RADIUS - 6));
  clipPath.appendChild(clipPathShape);
  defs.appendChild(clipPath);
  svg.appendChild(defs);

  const detailGroup = createSvgEl("g", "cof-detail");
  const outerGroup = createSvgEl("g", "cof-outer");
  const secondaryGroup = createSvgEl("g", "cof-secondary");
  const dimGroup = createSvgEl("g", "cof-dim");
  const modeBannerGroup = createSvgEl("g", "cof-mode-banner-layer");
  modeBannerGroup.setAttribute("clip-path", `url(#${clipId})`);
  const modeBannerTexts = MODE_BANNER_LINE_OFFSETS.map((rowOffset, rowIndex) => {
    const text = createSvgEl("text", "cof-mode-banner");
    text.setAttribute("x", String(-VIEWBOX_SIZE + (rowIndex % 2 === 0 ? 0 : 120)));
    text.setAttribute("y", String(CENTER + rowOffset * MODE_BANNER_LINE_GAP));
    modeBannerGroup.appendChild(text);
    return text;
  });
  const outerPulseGroup = createSvgEl("g", "cof-pulse-layer");
  const detailPulseGroup = createSvgEl("g", "cof-pulse-layer cof-pulse-layer--detail");

  svg.appendChild(outerGroup);
  svg.appendChild(modeBannerGroup);
  detailGroup.appendChild(secondaryGroup);
  detailGroup.appendChild(dimGroup);
  detailGroup.appendChild(detailPulseGroup);
  svg.appendChild(detailGroup);
  svg.appendChild(outerPulseGroup);
  root.appendChild(svg);

  const noteBar = document.createElement("div");
  noteBar.className = "cof-note-bar";
  const noteCells = new Map<number, HTMLDivElement>();
  const notePulseTimeouts = new Map<number, number>();
  NOTE_BAR_ORDER_SEMITONES.forEach((semitone, idx) => {
    const cell = document.createElement("div");
    cell.className = "cof-note-cell";
    cell.setAttribute("data-semitone", String(semitone));
    cell.setAttribute("role", "button");
    cell.setAttribute("tabindex", "0");
    const label = document.createElement("span");
    label.className = "cof-note-cell-label";
    label.textContent = NOTE_BAR_LABELS[idx] ?? "?";
    cell.appendChild(label);
    const midi = midiFromSemitoneNearC4(semitone);
    const noteLabel = NOTE_BAR_LABELS[idx] ?? "?";
    const activate = (): void => {
      pulseNoteCells([semitone], semitone, 520);
      options.onNoteBarTap?.({ label: noteLabel, midi });
    };
    cell.addEventListener("click", activate);
    cell.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate();
    });
    noteBar.appendChild(cell);
    noteCells.set(semitone, cell);
  });
  const frame = document.createElement("div");
  frame.className = "cof-frame";
  frame.appendChild(root);
  frame.appendChild(noteBar);
  container.replaceChildren(frame);

  let primaryIndex: number | null = null;
  let selection: CircleSelection | null = null;
  let chordModeEnabled = false;
  let minorModeEnabled = false;
  let detuneDeg = 0;
  let detailBaseDeg = 0;
  let pendingOuterClickTimeout: number | null = null;
  const pulseTimeouts = new Set<number>();

  // UI state transitions:
  // - primary selection controls detail visibility/content
  // - chord mode toggles outer label suffix + background-tap exit behavior
  // - minor mode remaps roman numerals only (does not change chord spellings)
  const clearPendingOuterClick = (): void => {
    if (pendingOuterClickTimeout === null) return;
    window.clearTimeout(pendingOuterClickTimeout);
    pendingOuterClickTimeout = null;
  };

  const showInnerCircleIndicator = (text: string): void => {
    modeBannerTexts.forEach((line) => {
      line.textContent = buildTessellatedIndicatorText(text, 18);
      line.classList.add("cof-mode-banner--indicator");
      line.classList.remove("is-scrolling");
    });
    void modeBannerGroup.getBoundingClientRect();
    modeBannerTexts.forEach((line) => {
      line.classList.add("is-scrolling");
    });
  };

  const queuePulseCleanup = (pulse: SVGGElement): void => {
    const timeoutId = window.setTimeout(() => {
      pulse.remove();
      pulseTimeouts.delete(timeoutId);
    }, WEDGE_PULSE_DURATION_MS + 60);
    pulseTimeouts.add(timeoutId);
  };

  const pulseNoteCells = (semitones: number[], rootSemitone: number | null, durationMs: number): void => {
    const normalized = Array.from(new Set(semitones.map((value) => wrapSemitone(value))));
    normalized.forEach((semitone) => {
      const cell = noteCells.get(semitone);
      if (!cell) return;
      const existingTimeout = notePulseTimeouts.get(semitone);
      if (existingTimeout !== undefined) {
        window.clearTimeout(existingTimeout);
      }
      cell.classList.remove("is-active", "is-root");
      cell.style.setProperty("--cof-note-pulse-ms", `${Math.max(120, durationMs)}ms`);
      void cell.getBoundingClientRect();
      cell.classList.add("is-active");
      if (rootSemitone !== null && semitone === wrapSemitone(rootSemitone)) {
        cell.classList.add("is-root");
      }
      const timeoutId = window.setTimeout(() => {
        cell.classList.remove("is-active", "is-root");
        notePulseTimeouts.delete(semitone);
      }, Math.max(140, durationMs));
      notePulseTimeouts.set(semitone, timeoutId);
    });
  };

  const updateNoteBarDegreeColors = (primarySemitone: number | null): void => {
    noteCells.forEach((cell, semitone) => {
      if (primarySemitone === null) {
        cell.removeAttribute("data-degree");
        cell.removeAttribute("data-diatonic");
        return;
      }
      const interval = wrapSemitone(semitone - primarySemitone);
      const token = degreeTokenForMajorInterval(interval);
      if (!token) {
        cell.removeAttribute("data-degree");
        cell.setAttribute("data-diatonic", "false");
        return;
      }
      cell.setAttribute("data-degree", degreeKeyFromToken(token));
      cell.setAttribute("data-diatonic", "true");
    });
  };

  const emitWedgePulse = (options: {
    pathD: string;
    label: string;
    x: number;
    y: number;
    outer: boolean;
    layer: "outer" | "detail";
  }): void => {
    const pulse = createSvgEl("g", "cof-pulse");
    const pulsePath = createSvgEl("path", "cof-pulse-path");
    pulsePath.setAttribute("d", options.pathD);
    pulse.appendChild(pulsePath);

    const pulseLabelBaseClass = options.outer
      ? "cof-pulse-label cof-pulse-label--outer"
      : "cof-pulse-label cof-pulse-label--inner";
    const pulseLabelClass =
      options.label.length >= 5
        ? `${pulseLabelBaseClass} cof-pulse-label--tight`
        : pulseLabelBaseClass;
    const pulseLabel = createSvgEl("text", pulseLabelClass);
    pulseLabel.setAttribute("x", String(options.x));
    pulseLabel.setAttribute("y", String(options.y));
    pulseLabel.textContent = options.label;
    pulse.appendChild(pulseLabel);

    pulse.addEventListener("animationend", () => {
      pulse.remove();
    });
    (options.layer === "detail" ? detailPulseGroup : outerPulseGroup).appendChild(pulse);
    queuePulseCleanup(pulse);
  };

  const applyDetailTransform = (): void => {
    detailGroup.style.transform = `rotate(${(detailBaseDeg + detuneDeg).toFixed(2)}deg)`;
  };

  const setDetailBaseForPrimary = (index: number | null): void => {
    if (index === null) {
      detailBaseDeg = 0;
      return;
    }
    const targetDeg = index * OUTER_STEP_DEG;
    const currentCanonical = normalizeDegrees(detailBaseDeg);
    const delta = normalizeSignedDegrees(targetDeg - currentCanonical);
    detailBaseDeg += delta;
  };

  const outerButtons = OUTER_NOTES.map((note, index) => {
    const centerDeg = index * OUTER_STEP_DEG;
    const node = createSvgEl("g", "cof-wedge");
    node.setAttribute("data-index", String(index));
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `Primary note ${note.label}`);

    const path = createSvgEl("path", "cof-wedge-path");
    path.setAttribute("d", describeAnnularSector(OUTER_INNER_RADIUS, OUTER_RADIUS, centerDeg, OUTER_WEDGE_DEG));
    node.appendChild(path);
    const hintPath = createSvgEl("path", "cof-wedge-hint");
    hintPath.setAttribute("d", describeAnnularSector(OUTER_INNER_RADIUS, OUTER_RADIUS, centerDeg, OUTER_WEDGE_DEG));
    node.appendChild(hintPath);

    const label = createSvgEl("text", "cof-wedge-label");
    const labelPoint = polarPoint((OUTER_RADIUS + OUTER_INNER_RADIUS) / 2, centerDeg);
    label.setAttribute("x", String(labelPoint.x));
    label.setAttribute("y", String(labelPoint.y));
    const labelRoot = createSvgEl("tspan", "cof-wedge-label-root");
    labelRoot.textContent = note.label;
    label.appendChild(labelRoot);
    node.appendChild(label);

    const degreeLabel = createSvgEl("text", "cof-degree-label");
    const degreeCorner = polarPoint(OUTER_RADIUS - 30, centerDeg + OUTER_WEDGE_DEG / 2 - 2);
    degreeLabel.setAttribute("x", String(degreeCorner.x));
    degreeLabel.setAttribute("y", String(degreeCorner.y));
    node.appendChild(degreeLabel);

    const emitOuterTap = (): CircleNoteTap => ({
      index,
      label: note.label,
      midi: midiFromSemitoneNearC4(note.semitone),
      isPrimary: index === primaryIndex,
    });

    const onActivate = (): void => {
      const tap = emitOuterTap();

      const pathD = path.getAttribute("d");
      if (pathD) {
        emitWedgePulse({
          pathD,
          label: note.label,
          x: labelPoint.x,
          y: labelPoint.y,
          outer: true,
          layer: "outer",
        });
      }

      options.onOuterTap?.(tap);
      if (chordModeEnabled) return;
      setPrimaryIndex(index);
      if (selection) options.onPrimaryTap?.(selection);
    };

    const onDoubleActivate = (): void => {
      const tap = emitOuterTap();
      options.onOuterDoubleTap?.(tap);
      if (primaryIndex === null) return;
      const active = OUTER_NOTES[primaryIndex];
      if (!active) return;
      const interval = wrapSemitone(note.semitone - active.semitone);
      const majorToken = degreeTokenForMajorInterval(interval);
      if (!majorToken) return;
      if (minorModeEnabled && majorToken === "I") {
        setMinorModeInternal(false);
      }
    };

    const shouldDelayForMinorToggle = (): boolean => {
      if (primaryIndex === null) return false;
      const active = OUTER_NOTES[primaryIndex];
      if (!active) return false;
      const interval = wrapSemitone(note.semitone - active.semitone);
      const majorToken = degreeTokenForMajorInterval(interval);
      if (!majorToken) return false;
      if (minorModeEnabled && majorToken === "I") return true;
      return false;
    };

    node.addEventListener("click", () => {
      if (!shouldDelayForMinorToggle()) {
        onActivate();
        return;
      }
      clearPendingOuterClick();
      pendingOuterClickTimeout = window.setTimeout(() => {
        pendingOuterClickTimeout = null;
        onActivate();
      }, OUTER_CLICK_DELAY_MS);
    });
    path.addEventListener("dblclick", (event) => {
      event.preventDefault();
      clearPendingOuterClick();
      onDoubleActivate();
    });
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onActivate();
    });

    outerGroup.appendChild(node);
    return { node, label, degreeLabel, note, hintPath };
  });

  const secondaryNodes = SECONDARY_CENTERS.map((centerDeg, cellIndex) => {
    const node = createSvgEl("g", "cof-secondary-cell");
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.setAttribute("data-center-deg", String(centerDeg));
    node.setAttribute("data-span-deg", String(SECONDARY_WEDGE_DEG));

    const path = createSvgEl("path", "cof-secondary-path");
    path.setAttribute(
      "d",
      describeAnnularSector(SECONDARY_INNER_RADIUS, SECONDARY_OUTER_RADIUS, centerDeg, SECONDARY_WEDGE_DEG)
    );
    node.appendChild(path);

    const text = createSvgEl("text", "cof-secondary-label");
    const labelPoint = polarPoint((SECONDARY_OUTER_RADIUS + SECONDARY_INNER_RADIUS) / 2, centerDeg);
    text.setAttribute("x", String(labelPoint.x));
    text.setAttribute("y", String(labelPoint.y));
    node.appendChild(text);
    const degreeText = createSvgEl("text", "cof-secondary-degree-label");
    const degreeCorner = polarPoint(SECONDARY_OUTER_RADIUS - 16, centerDeg + SECONDARY_WEDGE_DEG / 2 - 2);
    degreeText.setAttribute("x", String(degreeCorner.x));
    degreeText.setAttribute("y", String(degreeCorner.y));
    const degreeLabel = SECONDARY_DEGREE_LABELS[cellIndex];
    if (degreeLabel) degreeText.textContent = degreeLabel;
    const degreeKey = SECONDARY_DEGREE_KEYS[cellIndex];
    if (degreeKey) node.setAttribute("data-degree", degreeKey);
    node.appendChild(degreeText);

    const activateSecondaryCell = (): void => {
      const chord = selection?.secondaryChords[cellIndex];
      const pathD = path.getAttribute("d");
      if (!chord || !pathD) return;
      emitWedgePulse({
        pathD,
        label: chord.label,
        x: labelPoint.x,
        y: labelPoint.y,
        outer: false,
        layer: "detail",
      });
      options.onSecondaryTap?.(chord);
    };

    node.addEventListener("click", activateSecondaryCell);
    if (cellIndex === 2) {
      path.addEventListener("dblclick", (event) => {
        event.preventDefault();
        if (!minorModeEnabled) {
          setMinorModeInternal(true);
        }
      });
    }

    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activateSecondaryCell();
    });

    secondaryGroup.appendChild(node);
    return { node, text, degreeText };
  });

  const dimNode = createSvgEl("g", "cof-dim-cell");
  dimNode.setAttribute("role", "button");
  dimNode.setAttribute("tabindex", "0");
  dimNode.setAttribute("data-center-deg", "0");
  dimNode.setAttribute("data-span-deg", String(DIM_WEDGE_DEG));

  const dimPath = createSvgEl("path", "cof-dim-path");
  dimPath.setAttribute("d", describeAnnularSector(DIM_INNER_RADIUS, DIM_OUTER_RADIUS, 0, DIM_WEDGE_DEG));
  dimNode.appendChild(dimPath);

  const dimText = createSvgEl("text", "cof-dim-label");
  const dimLabelPoint = polarPoint((DIM_OUTER_RADIUS + DIM_INNER_RADIUS) / 2, 0);
  dimText.setAttribute("x", String(dimLabelPoint.x));
  dimText.setAttribute("y", String(dimLabelPoint.y));
  dimNode.appendChild(dimText);
  const dimDegreeText = createSvgEl("text", "cof-dim-degree-label");
  const dimDegreeCorner = polarPoint(DIM_OUTER_RADIUS - 14, DIM_WEDGE_DEG / 2 - 2);
  dimDegreeText.setAttribute("x", String(dimDegreeCorner.x));
  dimDegreeText.setAttribute("y", String(dimDegreeCorner.y));
  dimDegreeText.textContent = DIM_DEGREE_LABEL;
  dimNode.setAttribute("data-degree", DIM_DEGREE_KEY);
  dimNode.appendChild(dimDegreeText);
  dimGroup.appendChild(dimNode);

  const playDiminished = (): void => {
    const pathD = dimPath.getAttribute("d");
    if (!selection || !pathD) return;
    emitWedgePulse({
      pathD,
      label: selection.diminishedChord.label,
      x: dimLabelPoint.x,
      y: dimLabelPoint.y,
      outer: false,
      layer: "detail",
    });
    options.onSecondaryTap?.(selection.diminishedChord);
  };

  dimNode.addEventListener("click", playDiminished);
  dimNode.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    playDiminished();
  });

  svg.addEventListener("click", (event) => {
    if (!chordModeEnabled) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const clickedWedge = target.closest(".cof-wedge, .cof-secondary-cell, .cof-dim-cell");
    if (clickedWedge) return;
    options.onBackgroundTap?.();
  });

  const updateOuterChordModeLabels = (): void => {
    root.classList.toggle("is-chord-mode", chordModeEnabled);
    outerButtons.forEach(({ label, note }) => {
      label.replaceChildren();
      const rootSpan = createSvgEl("tspan", "cof-wedge-label-root");
      rootSpan.textContent = note.label;
      label.appendChild(rootSpan);

      if (chordModeEnabled) {
        const suffixSpan = createSvgEl("tspan", "cof-wedge-label-suffix");
        suffixSpan.textContent = "maj";
        suffixSpan.setAttribute("dx", "3");
        label.appendChild(suffixSpan);
      }
    });
  };

  const setPrimaryIndex = (nextPrimaryIndex: number | null): void => {
    const prevPrimaryIndex = primaryIndex;
    primaryIndex = nextPrimaryIndex;
    selection = nextPrimaryIndex === null ? null : getSelectionFromPrimary(nextPrimaryIndex);
    setDetailBaseForPrimary(nextPrimaryIndex);
    updateNoteBarDegreeColors(nextPrimaryIndex === null ? null : (OUTER_NOTES[nextPrimaryIndex]?.semitone ?? null));

    const resetOuterDegreeVisual = (node: SVGGElement, degreeLabel: SVGTextElement, hintPath: SVGPathElement): void => {
      degreeLabel.textContent = "";
      node.removeAttribute("data-degree");
      hintPath.removeAttribute("fill");
    };

    outerButtons.forEach(({ node, degreeLabel, note, hintPath }, index) => {
      const isPrimary = index === primaryIndex;
      node.classList.toggle("is-primary", isPrimary);
      node.setAttribute("aria-pressed", isPrimary ? "true" : "false");

      if (nextPrimaryIndex === null) {
        resetOuterDegreeVisual(node, degreeLabel, hintPath);
        return;
      }
      const active = OUTER_NOTES[nextPrimaryIndex];
      if (!active) {
        resetOuterDegreeVisual(node, degreeLabel, hintPath);
        return;
      }
      const interval = wrapSemitone(note.semitone - active.semitone);
      const degreeToken = degreeTokenForMajorInterval(interval);
      degreeLabel.textContent = outerDegreeLabelForMode(degreeToken, minorModeEnabled);
      if (!degreeToken) {
        resetOuterDegreeVisual(node, degreeLabel, hintPath);
        return;
      }
      const degreeKey = degreeKeyFromToken(degreeToken);
      node.setAttribute("data-degree", degreeKey);
      if (degreeKey === "ii" || degreeKey === "iii" || degreeKey === "vi") {
        hintPath.setAttribute("fill", `url(#${outerHintThirdId})`);
      } else if (degreeKey === "vii") {
        hintPath.setAttribute("fill", `url(#${outerHintDimId})`);
      } else {
        hintPath.removeAttribute("fill");
      }
    });

    if (!selection || primaryIndex === null) {
      root.classList.remove("has-primary");
      frame.classList.remove("has-primary");
      detuneDeg = 0;
      applyDetailTransform();
      return;
    }

    const activeSelection = selection;
    root.classList.add("has-primary");
    frame.classList.add("has-primary");
    applyDetailTransform();

    secondaryNodes.forEach(({ node, text, degreeText }, index) => {
      const chord = activeSelection.secondaryChords[index];
      if (!chord) return;
      text.textContent = chord.label;
      setTextClassForFit(text, "cof-secondary-label", chord.label);
      const baseDegreeLabel = SECONDARY_DEGREE_LABELS[index];
      degreeText.textContent = innerDegreeLabelForMode(baseDegreeLabel ?? "", minorModeEnabled);
      node.setAttribute("aria-label", `Chord ${chord.label}`);
    });

    dimText.textContent = activeSelection.diminishedChord.label;
    setTextClassForFit(dimText, "cof-dim-label", activeSelection.diminishedChord.label);
    dimDegreeText.textContent = innerDegreeLabelForMode(DIM_DEGREE_LABEL, minorModeEnabled);
    dimNode.setAttribute("aria-label", `Chord ${activeSelection.diminishedChord.label}`);

    if (prevPrimaryIndex !== primaryIndex) {
      showInnerCircleIndicator(activeSelection.primaryLabel);
    }
  };

  const setMinorModeInternal = (enabled: boolean): void => {
    if (minorModeEnabled === enabled) return;
    minorModeEnabled = enabled;
    showInnerCircleIndicator(enabled ? "minor" : "MAJOR");
    if (primaryIndex !== null) setPrimaryIndex(primaryIndex);
  };

  return {
    setPrimaryByLabel(label: string | null) {
      if (!label) {
        setPrimaryIndex(null);
        return;
      }
      const index = OUTER_NOTES.findIndex((item) => item.label === label);
      if (index >= 0) setPrimaryIndex(index);
    },
    setPrimaryByMidi(midi: number | null) {
      if (midi === null) {
        setPrimaryIndex(null);
        return;
      }
      const semitone = wrapSemitone(midi);
      const index = OUTER_NOTES.findIndex((item) => item.semitone === semitone);
      if (index >= 0) setPrimaryIndex(index);
    },
    setTuningCents(cents: number | null) {
      if (primaryIndex === null || cents === null) {
        detuneDeg = 0;
        applyDetailTransform();
        return;
      }
      detuneDeg = clamp((cents / 7) * 8, -12, 12);
      applyDetailTransform();
    },
    setChordMode(enabled: boolean) {
      if (chordModeEnabled === enabled) return;
      chordModeEnabled = enabled;
      showInnerCircleIndicator(enabled ? "CHORD" : "NOTE");
      updateOuterChordModeLabels();
    },
    setMinorMode(enabled: boolean) {
      setMinorModeInternal(enabled);
    },
    pulseNote(midi: number, durationMs = 400) {
      pulseNoteCells([midi], midi, durationMs);
    },
    pulseChord(midis: number[], durationMs = 640) {
      if (!midis.length) return;
      pulseNoteCells(midis, midis[0] ?? null, durationMs);
    },
    destroy() {
      clearPendingOuterClick();
      notePulseTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      notePulseTimeouts.clear();
      pulseTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      pulseTimeouts.clear();
      container.replaceChildren();
    },
  };
}

