import { clamp } from "../utils.js";
import {
  createCircleNoteBar,
  type CircleNoteBarDegreeKey,
  type CircleNoteBarDegreeToken,
  type CircleNoteBarUiOptions,
} from "./circle-note-bar.js";

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
  // Callback contract:
  // - Tap/double-tap/press callbacks fire from direct user interaction on wedges/note-bar/background.
  // - `onBackgroundPulseRequest` and `onBackgroundRandomnessRequest` are UI-originated signals intended
  //   for mode-owned background effects (for example Seigaiha pulse/randomness), not for in-UI rendering.
  // Usage limits:
  // - Callbacks should not directly mutate Circle UI DOM internals; use returned UI methods instead.
  // - Callbacks should be quick and non-blocking (no long sync work), because they run on interaction paths.
  onSecondaryTap?: (chord: CircleChordSpec) => void;
  onOuterTap?: (note: CircleNoteTap) => void;
  onOuterPressStart?: (note: CircleNoteTap) => void;
  onOuterPressEnd?: (note: CircleNoteTap) => void;
  onSecondaryPressStart?: (chord: CircleChordSpec) => void;
  onSecondaryPressEnd?: (chord: CircleChordSpec) => void;
  onInnerDoubleTap?: () => void;
  onNoteBarTap?: (note: { label: string; midi: number }) => void;
  onNoteBarPressStart?: (note: { label: string; midi: number }) => void;
  onNoteBarPressEnd?: (note: { label: string; midi: number }) => void;
  onBackgroundTap?: () => void;
  onBackgroundPulseRequest?: () => void;
  onBackgroundRandomnessRequest?: (randomness: number) => void;
};

export type CircleOfFifthsUi = {
  setPrimaryByLabel: (label: string | null) => void;
  setPrimaryByMidi: (midi: number | null) => void;
  setTuningCents: (cents: number | null) => void;
  setMinorMode: (enabled: boolean) => void;
  setInstrumentLabel: (text: string) => void;
  showInnerIndicator: (text: string) => void;
  pulseNote: (midi: number, durationMs?: number) => void;
  pulseChord: (midis: number[], durationMs?: number) => void;
  holdNote: (midi: number) => void;
  holdChord: (midis: number[]) => void;
  releaseHeldNotes: () => void;
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
  zone: "note" | "chord";
  movesPrimary: boolean;
};

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEWBOX_SIZE = 1000;
const CENTER = VIEWBOX_SIZE / 2;

const OUTER_RADIUS = 450;
const OUTER_INNER_RADIUS = 320;
const SECONDARY_OUTER_RADIUS = 318;
const SECONDARY_INNER_RADIUS = 224;
const DIM_OUTER_RADIUS = 218;
const DIM_INNER_RADIUS = 160;

const OUTER_STEP_DEG = 30;
const OUTER_WEDGE_DEG = 25;
const ZOOMED_VIEWBOX_SIZE = 700;
const ZOOM_FOCUS_RADIUS = 165;
const SECONDARY_WEDGE_DEG = 24;
const DIM_WEDGE_DEG = 24;

// Kiku flower dimensions per ring
const OUTER_FLOWER_R        = 82;
const OUTER_PETAL_COUNT     = 16;
const SECONDARY_FLOWER_R    = 48;
const SECONDARY_PETAL_COUNT = 14;
const DIM_FLOWER_R          = 30;
const DIM_PETAL_COUNT       = 12;

const INSTRUMENT_LABEL_RADIUS = DIM_INNER_RADIUS - 18;
const SECONDARY_CENTERS = [-30, 0, 30] as const;
const SECONDARY_INTERVALS = [2, 4, 9] as const; // II, III, VI
const SECONDARY_DEGREE_LABELS = ["ii", "iii", "vi"] as const;
const DIM_DEGREE_LABEL = "vii°";
const SECONDARY_DEGREE_KEYS = ["ii", "iii", "vi"] as const;
const DIM_DEGREE_KEY = "vii";
const WEDGE_PULSE_DURATION_MS = 640;
const MODE_BANNER_LINE_OFFSETS = [-2, -1, 0, 1, 2] as const;
const MODE_BANNER_LINE_GAP = 72;
let circleModeBannerSeq = 0;

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

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function normalizeSignedDegrees(value: number): number {
  return ((value + 540) % 360) - 180;
}

export function wrapSemitone(value: number): number {
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


function degreeTokenForMajorInterval(interval: number): CircleNoteBarDegreeToken | null {
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

function degreeKeyFromToken(token: CircleNoteBarDegreeToken): CircleNoteBarDegreeKey {
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

function minorTokenFromMajorToken(token: CircleNoteBarDegreeToken): string {
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

function outerDegreeLabelForMode(token: CircleNoteBarDegreeToken | null, minorMode: boolean): string {
  if (!token) return "";
  if (!minorMode) return token === "I" || token === "IV" || token === "V" ? token : "";
  if (token === "I" || token === "IV" || token === "V") return minorTokenFromMajorToken(token);
  return "";
}

function noteBarDegreeLabelForMode(token: CircleNoteBarDegreeToken | null, minorMode: boolean): string {
  if (!token) return "";
  if (!minorMode) {
    switch (token) {
      case "I":
        return "I";
      case "ii":
        return "II";
      case "iii":
        return "III";
      case "IV":
        return "IV";
      case "V":
        return "V";
      case "vi":
        return "VI";
      case "vii°":
        return "VII°";
    }
  }
  switch (token) {
    case "I":
      return "III";
    case "ii":
      return "IV";
    case "iii":
      return "V";
    case "IV":
      return "VI";
    case "V":
      return "VII";
    case "vi":
      return "I";
    case "vii°":
      return "II°";
  }
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


// Returns a compound SVG path describing a kiku (chrysanthemum) flower.
// Matches the traditional kiku crest: a filled center circle, plus petals that
// narrow at the base and widen to a rounded tip circle at the outer end.
function describeKikuFlower(
  fcx: number,
  fcy: number,
  flowerR: number,
  petalCount: number
): string {
  const innerR = flowerR * 0.14;  // center circle radius
  const baseR  = flowerR * 0.22;  // radius where petals attach
  const tipCR  = flowerR * 0.87;  // outer tip circle center radius
  const tipR   = flowerR * 0.13;  // outer tip circle radius
  const baseHW = flowerR * 0.024; // half-width at inner base

  // Center circle sub-path
  let d = `M ${fcx + innerR} ${fcy} A ${innerR} ${innerR} 0 1 0 ${fcx - innerR} ${fcy} A ${innerR} ${innerR} 0 1 0 ${fcx + innerR} ${fcy} Z `;

  for (let i = 0; i < petalCount; i++) {
    const a  = (i * 2 * Math.PI / petalCount) - Math.PI / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const px = -sa, py = ca; // perpendicular (90° CCW from petal axis)

    // Base points at radius baseR, ±baseHW perpendicular
    const s1x = fcx + baseR * ca + baseHW * px;
    const s1y = fcy + baseR * sa + baseHW * py;
    const s2x = fcx + baseR * ca - baseHW * px;
    const s2y = fcy + baseR * sa - baseHW * py;

    // Tip circle edge points at radius tipCR, ±tipR perpendicular
    const t1x = fcx + tipCR * ca + tipR * px;
    const t1y = fcy + tipCR * sa + tipR * py;
    const t2x = fcx + tipCR * ca - tipR * px;
    const t2y = fcy + tipCR * sa - tipR * py;

    // s2 → line to t2 → CW arc (outer tip) to t1 → line to s1 → CCW short arc back to s2
    d += `M ${s2x} ${s2y} `;
    d += `L ${t2x} ${t2y} `;
    d += `A ${tipR} ${tipR} 0 0 1 ${t1x} ${t1y} `;  // sweep=1: CW through outer tip
    d += `L ${s1x} ${s1y} `;
    d += `A ${baseR} ${baseR} 0 0 0 ${s2x} ${s2y} Z `;  // short CCW base arc
  }

  return d;
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
    text.setAttribute("x", String(VIEWBOX_SIZE + (rowIndex % 2 === 0 ? 0 : 120)));
    text.setAttribute("y", String(CENTER + rowOffset * MODE_BANNER_LINE_GAP));
    modeBannerGroup.appendChild(text);
    return text;
  });
  // Instrument label arcs along the inner circle, antipodal to the detail wedges.
  const instrumentArcId = `cof-instrument-arc-${instanceId}`;
  const instrumentArcPath = createSvgEl("path");
  instrumentArcPath.setAttribute("id", instrumentArcId);
  instrumentArcPath.setAttribute("fill", "none");
  defs.appendChild(instrumentArcPath);

  const instrumentLabelGroup = createSvgEl("g", "cof-instrument-label-layer");
  const instrumentLabelText = createSvgEl("text", "cof-instrument-label");
  const instrumentTextPath = createSvgEl("textPath");
  instrumentTextPath.setAttribute("href", `#${instrumentArcId}`);
  instrumentTextPath.setAttribute("startOffset", "50%");
  instrumentTextPath.setAttribute("text-anchor", "middle");
  instrumentTextPath.textContent = "ACOUSTIC GUITAR";
  instrumentLabelText.appendChild(instrumentTextPath);
  instrumentLabelGroup.appendChild(instrumentLabelText);
  const outerPulseGroup = createSvgEl("g", "cof-pulse-layer");
  const detailPulseGroup = createSvgEl("g", "cof-pulse-layer cof-pulse-layer--detail");

  svg.appendChild(outerGroup);
  svg.appendChild(instrumentLabelGroup);
  svg.appendChild(modeBannerGroup);
  detailGroup.appendChild(secondaryGroup);
  detailGroup.appendChild(dimGroup);
  detailGroup.appendChild(detailPulseGroup);
  svg.appendChild(detailGroup);
  svg.appendChild(outerPulseGroup);
  root.appendChild(svg);

  const noteBarOptions: CircleNoteBarUiOptions = {
    degreeLabelForMode: (token: CircleNoteBarDegreeToken | null) =>
      noteBarDegreeLabelForMode(token, minorModeEnabled),
    degreeTokenForInterval: degreeTokenForMajorInterval,
    degreeKeyFromToken,
  };
  if (options.onNoteBarTap) noteBarOptions.onTap = options.onNoteBarTap;
  if (options.onNoteBarPressStart) noteBarOptions.onPressStart = options.onNoteBarPressStart;
  if (options.onNoteBarPressEnd) noteBarOptions.onPressEnd = options.onNoteBarPressEnd;
  if (options.onBackgroundPulseRequest) noteBarOptions.onPulseRequest = options.onBackgroundPulseRequest;
  if (options.onBackgroundRandomnessRequest) {
    noteBarOptions.onRandomnessRequest = options.onBackgroundRandomnessRequest;
  }
  const noteBar = createCircleNoteBar(noteBarOptions);
  const frame = document.createElement("div");
  frame.className = "cof-frame";
  frame.appendChild(root);
  frame.appendChild(noteBar.element);
  container.replaceChildren(frame);

  let primaryIndex: number | null = null;
  let selection: CircleSelection | null = null;
  let minorModeEnabled = false;
  let instrumentLabel = "ACOUSTIC GUITAR";
  let detuneDeg = 0;
  let detailBaseDeg = 0;
  let lastBackgroundTapAt = 0;
  let lastBackgroundTapX = 0;
  let lastBackgroundTapY = 0;
  const pulseTimeouts = new Set<number>();

  // UI state transitions:
  // - primary selection controls detail visibility/content
  // - chord mode toggles outer label suffix + background-tap exit behavior
  // - minor mode remaps roman numerals only (does not change chord spellings)

  const getSvgViewBoxRect = (): { x: number; y: number; width: number; height: number } => {
    const attribute = svg.getAttribute("viewBox");
    if (!attribute) {
      return { x: 0, y: 0, width: VIEWBOX_SIZE, height: VIEWBOX_SIZE };
    }
    const values = attribute
      .split(/\s+/)
      .map((token) => Number(token))
      .filter((value) => Number.isFinite(value));
    if (values.length < 4) {
      return { x: 0, y: 0, width: VIEWBOX_SIZE, height: VIEWBOX_SIZE };
    }
    return {
      x: values[0] ?? 0,
      y: values[1] ?? 0,
      width: values[2] ?? VIEWBOX_SIZE,
      height: values[3] ?? VIEWBOX_SIZE,
    };
  };

  const clientToSvgPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = svg.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const viewBox = getSvgViewBoxRect();
    const x = viewBox.x + (px / Math.max(1, rect.width)) * viewBox.width;
    const y = viewBox.y + (py / Math.max(1, rect.height)) * viewBox.height;
    return { x, y };
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

  const INSTRUMENT_ARC_RADIUS = INSTRUMENT_LABEL_RADIUS;
  const INSTRUMENT_ARC_SPAN_DEG = 160;

  const updateInstrumentLabelPlacement = (): void => {
    instrumentTextPath.textContent = instrumentLabel;
    // Arc is centered at the antipode of the detail wedge group so the label
    // always appears on the opposite side from the inner circle wedges.
    const antipodalDeg = normalizeDegrees(detailBaseDeg + 180);
    const startDeg = antipodalDeg - INSTRUMENT_ARC_SPAN_DEG / 2;
    const endDeg = antipodalDeg + INSTRUMENT_ARC_SPAN_DEG / 2;
    const startPt = polarPoint(INSTRUMENT_ARC_RADIUS, startDeg);
    const endPt = polarPoint(INSTRUMENT_ARC_RADIUS, endDeg);
    instrumentArcPath.setAttribute(
      "d",
      `M ${startPt.x.toFixed(2)} ${startPt.y.toFixed(2)} A ${INSTRUMENT_ARC_RADIUS} ${INSTRUMENT_ARC_RADIUS} 0 0 1 ${endPt.x.toFixed(2)} ${endPt.y.toFixed(2)}`
    );
  };


  const queuePulseCleanup = (pulse: SVGGElement): void => {
    const timeoutId = window.setTimeout(() => {
      pulse.remove();
      pulseTimeouts.delete(timeoutId);
    }, WEDGE_PULSE_DURATION_MS + 60);
    pulseTimeouts.add(timeoutId);
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
    const angle = detailBaseDeg + detuneDeg;
    detailGroup.setAttribute(
      "transform",
      `translate(${CENTER} ${CENTER}) rotate(${angle.toFixed(2)}) translate(${-CENTER} ${-CENTER})`
    );
    updateInstrumentLabelPlacement();
  };

  const applyChordZoom = (primaryIdx: number | null): void => {
    if (primaryIdx === null) {
      svg.setAttribute("viewBox", `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`);
      return;
    }
    const zoomCenterDeg = primaryIdx * OUTER_STEP_DEG;
    const focusPoint = polarPoint(ZOOM_FOCUS_RADIUS, zoomCenterDeg);
    const half = ZOOMED_VIEWBOX_SIZE / 2;
    const maxOffset = VIEWBOX_SIZE - ZOOMED_VIEWBOX_SIZE;
    const x = clamp(focusPoint.x - half, 0, maxOffset);
    const y = clamp(focusPoint.y - half, 0, maxOffset);
    svg.setAttribute("viewBox", `${x.toFixed(2)} ${y.toFixed(2)} ${ZOOMED_VIEWBOX_SIZE} ${ZOOMED_VIEWBOX_SIZE}`);
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

    // Kiku flower replaces the annular sector wedge.
    const flowerCenter = polarPoint((OUTER_INNER_RADIUS + OUTER_RADIUS) / 2, centerDeg);
    const kikuD = describeKikuFlower(flowerCenter.x, flowerCenter.y, OUTER_FLOWER_R, OUTER_PETAL_COUNT);

    const path = createSvgEl("path", "cof-wedge-path");
    path.setAttribute("d", kikuD);
    path.setAttribute("fill-rule", "evenodd");
    node.appendChild(path);
    const hintPath = createSvgEl("path", "cof-wedge-hint");
    hintPath.setAttribute("d", kikuD);
    hintPath.setAttribute("fill-rule", "evenodd");
    node.appendChild(hintPath);
    // Zone gradient: smooth light-to-dark tint from CCW edge to CW edge.
    const midRadius = (OUTER_INNER_RADIUS + OUTER_RADIUS) / 2;
    const ccwEdgeDeg = centerDeg - OUTER_WEDGE_DEG / 2;
    const cwEdgeDeg = centerDeg + OUTER_WEDGE_DEG / 2;
    const ccwPt = polarPoint(midRadius, ccwEdgeDeg);
    const cwPt = polarPoint(midRadius, cwEdgeDeg);
    const zoneGradId = `cof-zone-grad-${instanceId}-${index}`;
    const zoneGrad = createSvgEl("linearGradient");
    zoneGrad.setAttribute("id", zoneGradId);
    zoneGrad.setAttribute("gradientUnits", "userSpaceOnUse");
    zoneGrad.setAttribute("x1", String(ccwPt.x));
    zoneGrad.setAttribute("y1", String(ccwPt.y));
    zoneGrad.setAttribute("x2", String(cwPt.x));
    zoneGrad.setAttribute("y2", String(cwPt.y));
    const zoneStop0 = createSvgEl("stop");
    zoneStop0.setAttribute("offset", "0%");
    zoneStop0.setAttribute("stop-color", "rgba(255,255,255,0.32)");
    zoneGrad.appendChild(zoneStop0);
    const zoneStop1 = createSvgEl("stop");
    zoneStop1.setAttribute("offset", "100%");
    zoneStop1.setAttribute("stop-color", "rgba(0,0,0,0.28)");
    zoneGrad.appendChild(zoneStop1);
    defs.appendChild(zoneGrad);
    const zoneGradPath = createSvgEl("path", "cof-wedge-zone-grad");
    zoneGradPath.setAttribute("d", kikuD);
    zoneGradPath.setAttribute("fill", `url(#${zoneGradId})`);
    zoneGradPath.setAttribute("pointer-events", "none");
    node.appendChild(zoneGradPath);

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

    const emitOuterTap = (zone: "note" | "chord", movesPrimary: boolean): CircleNoteTap => ({
      index,
      label: note.label,
      midi: midiFromSemitoneNearC4(note.semitone),
      isPrimary: index === primaryIndex,
      zone,
      movesPrimary,
    });

    const onActivate = (clientX: number | null, clientY: number | null): void => {
      // Determine CW vs CCW zone from tap position.
      // CW zone (60% of wedge) = chord tap; CCW zone (40%) = note-only tap.
      const isChordSide = (clientX === null || clientY === null) ? true : (() => {
        const pt = clientToSvgPoint(clientX, clientY);
        const dx = pt.x - CENTER;
        const dy = pt.y - CENTER;
        const angleDeg = normalizeDegrees((Math.atan2(dy, dx) * 180 / Math.PI) + 90);
        const delta = normalizeSignedDegrees(angleDeg - centerDeg);
        return delta >= -(OUTER_WEDGE_DEG * 0.1);
      })();

      // Check if this wedge is IV or V relative to current primary.
      const isIVorV = (() => {
        if (primaryIndex === null) return false;
        const active = OUTER_NOTES[primaryIndex];
        if (!active) return false;
        const interval = wrapSemitone(note.semitone - active.semitone);
        const token = degreeTokenForMajorInterval(interval);
        return token === "IV" || token === "V";
      })();

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
      options.onBackgroundPulseRequest?.();
      options.onBackgroundRandomnessRequest?.(0.75);

      if (isChordSide) {
        // CW zone: move inner circle only if not IV/V.
        const movesPrimary = !isIVorV;
        if (movesPrimary) {
          setPrimaryIndex(index);
        }
        options.onOuterTap?.(emitOuterTap("chord", movesPrimary));
      } else {
        // CCW zone: note only, no primary change.
        options.onOuterTap?.(emitOuterTap("note", false));
      }
    };

    const onDoubleActivate = (): void => {
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

    let activePointerId: number | null = null;
    let suppressNextClick = false;

    const maybeActivateOuterTap = (clientX: number, clientY: number): void => {
      onActivate(clientX, clientY);
    };

    const startOuterPress = (event: PointerEvent): void => {
      if (!event.isPrimary || event.button !== 0) return;
      if (activePointerId !== null) return;
      activePointerId = event.pointerId;
      node.classList.add("is-holding");
      options.onBackgroundPulseRequest?.();
      options.onBackgroundRandomnessRequest?.(0.75);
      // Detect zone for press using same CW/CCW logic as onActivate.
      const pt = clientToSvgPoint(event.clientX, event.clientY);
      const dx = pt.x - CENTER;
      const dy = pt.y - CENTER;
      const angleDeg = normalizeDegrees((Math.atan2(dy, dx) * 180 / Math.PI) + 90);
      const delta = normalizeSignedDegrees(angleDeg - centerDeg);
      const isChordSide = delta >= -(OUTER_WEDGE_DEG * 0.1);
      const pressZone: "note" | "chord" = isChordSide ? "chord" : "note";
      options.onOuterPressStart?.(emitOuterTap(pressZone, false));
      // Run the tap action on pointerdown so touch/pen input does not wait for
      // post-release synthetic click dispatch.
      maybeActivateOuterTap(event.clientX, event.clientY);
      suppressNextClick = true;
    };

    const endOuterPress = (event: PointerEvent): void => {
      if (activePointerId === null) return;
      if (event.pointerId !== activePointerId) return;
      activePointerId = null;
      node.classList.remove("is-holding");
      options.onOuterPressEnd?.(emitOuterTap("chord", false));
    };

    node.addEventListener("click", (event) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      maybeActivateOuterTap(event.clientX, event.clientY);
    });
    path.addEventListener("dblclick", (event) => {
      event.preventDefault();
      onDoubleActivate();
    });
    node.addEventListener("pointerdown", startOuterPress);
    node.addEventListener("pointerup", endOuterPress);
    node.addEventListener("pointercancel", endOuterPress);
    node.addEventListener("pointerleave", endOuterPress);
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      // Keyboard: no pointer position, treat as chord side.
      onActivate(null, null);
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

    const secFlowerCenter = polarPoint((SECONDARY_INNER_RADIUS + SECONDARY_OUTER_RADIUS) / 2, centerDeg);
    const path = createSvgEl("path", "cof-secondary-path");
    path.setAttribute(
      "d",
      describeKikuFlower(secFlowerCenter.x, secFlowerCenter.y, SECONDARY_FLOWER_R, SECONDARY_PETAL_COUNT)
    );
    path.setAttribute("fill-rule", "evenodd");
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
      options.onBackgroundPulseRequest?.();
      options.onBackgroundRandomnessRequest?.(0.75);
      options.onSecondaryTap?.(chord);
    };

    let activePointerId: number | null = null;
    let heldChord: CircleChordSpec | null = null;
    const startSecondaryPress = (event: PointerEvent): void => {
      if (activePointerId !== null) return;
      const chord = selection?.secondaryChords[cellIndex];
      if (!chord) return;
      activePointerId = event.pointerId;
      heldChord = chord;
      node.classList.add("is-holding");
      options.onBackgroundPulseRequest?.();
      options.onBackgroundRandomnessRequest?.(0.75);
      options.onSecondaryPressStart?.(chord);
    };

    const endSecondaryPress = (event: PointerEvent): void => {
      if (activePointerId === null) return;
      if (event.pointerId !== activePointerId) return;
      activePointerId = null;
      node.classList.remove("is-holding");
      if (heldChord) {
        options.onSecondaryPressEnd?.(heldChord);
      }
      heldChord = null;
    };

    node.addEventListener("click", activateSecondaryCell);
    node.addEventListener("pointerdown", startSecondaryPress);
    node.addEventListener("pointerup", endSecondaryPress);
    node.addEventListener("pointercancel", endSecondaryPress);
    node.addEventListener("pointerleave", endSecondaryPress);
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

  const dimFlowerCenter = polarPoint((DIM_INNER_RADIUS + DIM_OUTER_RADIUS) / 2, 0);
  const dimPath = createSvgEl("path", "cof-dim-path");
  dimPath.setAttribute("d", describeKikuFlower(dimFlowerCenter.x, dimFlowerCenter.y, DIM_FLOWER_R, DIM_PETAL_COUNT));
  dimPath.setAttribute("fill-rule", "evenodd");
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
    options.onBackgroundPulseRequest?.();
    options.onBackgroundRandomnessRequest?.(0.75);
    options.onSecondaryTap?.(selection.diminishedChord);
  };

  let dimPointerId: number | null = null;
  let heldDimChord: CircleChordSpec | null = null;
  const startDimPress = (event: PointerEvent): void => {
    if (dimPointerId !== null) return;
    if (!selection) return;
    dimPointerId = event.pointerId;
    heldDimChord = selection.diminishedChord;
    dimNode.classList.add("is-holding");
    options.onBackgroundPulseRequest?.();
    options.onBackgroundRandomnessRequest?.(0.75);
    options.onSecondaryPressStart?.(selection.diminishedChord);
  };

  const endDimPress = (event: PointerEvent): void => {
    if (dimPointerId === null) return;
    if (event.pointerId !== dimPointerId) return;
    dimPointerId = null;
    dimNode.classList.remove("is-holding");
    if (heldDimChord) {
      options.onSecondaryPressEnd?.(heldDimChord);
    }
    heldDimChord = null;
  };

  dimNode.addEventListener("click", playDiminished);
  dimNode.addEventListener("pointerdown", startDimPress);
  dimNode.addEventListener("pointerup", endDimPress);
  dimNode.addEventListener("pointercancel", endDimPress);
  dimNode.addEventListener("pointerleave", endDimPress);
  dimNode.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    playDiminished();
  });

  // Tapping outside the circle when inner circle is visible hides it (no sound).
  const maybeHandleBackgroundTap = (
    target: EventTarget | null,
    clientX: number,
    clientY: number
  ): void => {
    if (primaryIndex === null) return;
    if (!(target instanceof Element)) return;
    const clickedWedge = target.closest(".cof-wedge, .cof-secondary-cell, .cof-dim-cell");
    if (clickedWedge) return;
    const point = clientToSvgPoint(clientX, clientY);
    const dx = point.x - CENTER;
    const dy = point.y - CENTER;
    if (Math.sqrt(dx * dx + dy * dy) <= OUTER_RADIUS) return;
    const now = performance.now();
    const nearDuplicate =
      now - lastBackgroundTapAt < 420 &&
      Math.abs(clientX - lastBackgroundTapX) <= 4 &&
      Math.abs(clientY - lastBackgroundTapY) <= 4;
    if (nearDuplicate) return;
    lastBackgroundTapAt = now;
    lastBackgroundTapX = clientX;
    lastBackgroundTapY = clientY;
    setPrimaryIndex(null);
    options.onBackgroundTap?.();
  };

  // Use pointerup only (not click) to avoid double-firing on desktop/mobile.
  // pointerup fires before the synthetic click, so we track it and suppress
  // the click if it's within 500ms of a handled pointerup at the same position.
  let lastBackgroundPointerUpAt = 0;
  let lastBackgroundPointerUpX = 0;
  let lastBackgroundPointerUpY = 0;

  svg.addEventListener("pointerup", (event) => {
    lastBackgroundPointerUpAt = performance.now();
    lastBackgroundPointerUpX = event.clientX;
    lastBackgroundPointerUpY = event.clientY;
    maybeHandleBackgroundTap(event.target, event.clientX, event.clientY);
  });

  svg.addEventListener("click", (event) => {
    // Suppress click if a pointerup at the same position was already handled.
    const dt = performance.now() - lastBackgroundPointerUpAt;
    const dx = Math.abs(event.clientX - lastBackgroundPointerUpX);
    const dy = Math.abs(event.clientY - lastBackgroundPointerUpY);
    if (dt < 500 && dx <= 6 && dy <= 6) return;
    maybeHandleBackgroundTap(event.target, event.clientX, event.clientY);
  });

  svg.addEventListener("dblclick", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".cof-wedge, .cof-secondary-cell, .cof-dim-cell")) return;
    const point = clientToSvgPoint(event.clientX, event.clientY);
    const dx = point.x - CENTER;
    const dy = point.y - CENTER;
    if (Math.sqrt(dx * dx + dy * dy) > OUTER_RADIUS) return;
    options.onInnerDoubleTap?.();
  });

  const setPrimaryIndex = (nextPrimaryIndex: number | null): void => {
    const prevPrimaryIndex = primaryIndex;
    primaryIndex = nextPrimaryIndex;
    updateInstrumentLabelPlacement();
    selection = nextPrimaryIndex === null ? null : getSelectionFromPrimary(nextPrimaryIndex);
    setDetailBaseForPrimary(nextPrimaryIndex);
    noteBar.updateDegrees(nextPrimaryIndex === null ? null : (OUTER_NOTES[nextPrimaryIndex]?.semitone ?? null));

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
      applyChordZoom(null);
      return;
    }

    const activeSelection = selection;
    root.classList.add("has-primary");
    frame.classList.add("has-primary");
    applyDetailTransform();
    applyChordZoom(primaryIndex);

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

  updateInstrumentLabelPlacement();

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
    setMinorMode(enabled: boolean) {
      setMinorModeInternal(enabled);
    },
    setInstrumentLabel(text: string) {
      instrumentLabel = text.trim() || "ACOUSTIC GUITAR";
      updateInstrumentLabelPlacement();
    },
    showInnerIndicator(text: string) {
      showInnerCircleIndicator(text);
    },
    pulseNote(midi: number, durationMs = 400) {
      noteBar.pulseNote(midi, durationMs);
    },
    pulseChord(midis: number[], durationMs = 640) {
      noteBar.pulseChord(midis, durationMs);
    },
    holdNote(midi: number) {
      noteBar.holdNote(midi);
    },
    holdChord(midis: number[]) {
      noteBar.holdChord(midis);
    },
    releaseHeldNotes() {
      noteBar.releaseHeldNotes();
    },
    destroy() {
      noteBar.destroy();
      pulseTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      pulseTimeouts.clear();
      container.replaceChildren();
    },
  };
}
