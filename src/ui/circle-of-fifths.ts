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
  onBackgroundTap?: () => void;
};

export type CircleOfFifthsUi = {
  setPrimaryByLabel: (label: string | null) => void;
  setPrimaryByMidi: (midi: number | null) => void;
  setTuningCents: (cents: number | null) => void;
  setChordMode: (enabled: boolean) => void;
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

const OUTER_WEDGE_DEG = 30;
const SECONDARY_WEDGE_DEG = 30;
const DIM_WEDGE_DEG = 30;
const SECONDARY_CENTERS = [-30, 0, 30] as const;
const SECONDARY_INTERVALS = [2, 4, 9] as const; // II, III, VI
const WEDGE_PULSE_DURATION_MS = 640;

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
  return quality === "diminished" ? `${root}dim` : `${root}m`;
}

function degreeLabelForMajorInterval(interval: number): string | null {
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

function setTextClassForFit(target: SVGTextElement, baseClass: string, text: string): void {
  const fitClass = text.length >= 5 ? `${baseClass} ${baseClass}--tight` : baseClass;
  target.setAttribute("class", fitClass);
}

export function createCircleOfFifthsUi(
  container: HTMLElement,
  options: CircleOfFifthsUiOptions = {}
): CircleOfFifthsUi {
  const root = document.createElement("section");
  root.className = "cof";

  const svg = createSvgEl("svg", "cof-svg");
  svg.setAttribute("viewBox", `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`);
  svg.setAttribute("aria-label", "Circle of Fifths");

  const detailGroup = createSvgEl("g", "cof-detail");
  const outerGroup = createSvgEl("g", "cof-outer");
  const secondaryGroup = createSvgEl("g", "cof-secondary");
  const dimGroup = createSvgEl("g", "cof-dim");
  const outerPulseGroup = createSvgEl("g", "cof-pulse-layer");
  const detailPulseGroup = createSvgEl("g", "cof-pulse-layer cof-pulse-layer--detail");

  svg.appendChild(outerGroup);
  detailGroup.appendChild(secondaryGroup);
  detailGroup.appendChild(dimGroup);
  detailGroup.appendChild(detailPulseGroup);
  svg.appendChild(detailGroup);
  svg.appendChild(outerPulseGroup);
  root.appendChild(svg);
  container.replaceChildren(root);

  let primaryIndex: number | null = null;
  let selection: CircleSelection | null = null;
  let chordModeEnabled = false;
  let detuneDeg = 0;
  let detailBaseDeg = 0;
  const pulseTimeouts = new Set<number>();

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
    detailGroup.style.transform = `rotate(${(detailBaseDeg + detuneDeg).toFixed(2)}deg)`;
  };

  const setDetailBaseForPrimary = (index: number | null): void => {
    if (index === null) {
      detailBaseDeg = 0;
      return;
    }
    const targetDeg = index * OUTER_WEDGE_DEG;
    const currentCanonical = normalizeDegrees(detailBaseDeg);
    const delta = normalizeSignedDegrees(targetDeg - currentCanonical);
    detailBaseDeg += delta;
  };

  const outerButtons = OUTER_NOTES.map((note, index) => {
    const centerDeg = index * OUTER_WEDGE_DEG;
    const node = createSvgEl("g", "cof-wedge");
    node.setAttribute("data-index", String(index));
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `Primary note ${note.label}`);

    const path = createSvgEl("path", "cof-wedge-path");
    path.setAttribute("d", describeAnnularSector(OUTER_INNER_RADIUS, OUTER_RADIUS, centerDeg, OUTER_WEDGE_DEG));
    node.appendChild(path);

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

    node.addEventListener("click", onActivate);
    node.addEventListener("dblclick", (event) => {
      event.preventDefault();
    });
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onActivate();
    });

    outerGroup.appendChild(node);
    return { node, label, degreeLabel, note };
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

    node.addEventListener("click", () => {
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
    });

    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
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
    });

    secondaryGroup.appendChild(node);
    return { node, text };
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
    primaryIndex = nextPrimaryIndex;
    selection = nextPrimaryIndex === null ? null : getSelectionFromPrimary(nextPrimaryIndex);
    setDetailBaseForPrimary(nextPrimaryIndex);

    outerButtons.forEach(({ node, degreeLabel, note }, index) => {
      const isPrimary = index === primaryIndex;
      node.classList.toggle("is-primary", isPrimary);
      node.setAttribute("aria-pressed", isPrimary ? "true" : "false");

      if (nextPrimaryIndex === null) {
        degreeLabel.textContent = "";
        return;
      }
      const active = OUTER_NOTES[nextPrimaryIndex];
      if (!active) {
        degreeLabel.textContent = "";
        return;
      }
      const interval = wrapSemitone(note.semitone - active.semitone);
      degreeLabel.textContent = degreeLabelForMajorInterval(interval) ?? "";
    });

    if (!selection || primaryIndex === null) {
      root.classList.remove("has-primary");
      detuneDeg = 0;
      applyDetailTransform();
      return;
    }

    const activeSelection = selection;
    root.classList.add("has-primary");
    applyDetailTransform();

    secondaryNodes.forEach(({ node, text }, index) => {
      const chord = activeSelection.secondaryChords[index];
      if (!chord) return;
      text.textContent = chord.label;
      setTextClassForFit(text, "cof-secondary-label", chord.label);
      node.setAttribute("aria-label", `Chord ${chord.label}`);
    });

    dimText.textContent = activeSelection.diminishedChord.label;
    setTextClassForFit(dimText, "cof-dim-label", activeSelection.diminishedChord.label);
    dimNode.setAttribute("aria-label", `Chord ${activeSelection.diminishedChord.label}`);
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
      chordModeEnabled = enabled;
      updateOuterChordModeLabels();
    },
    destroy() {
      pulseTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      pulseTimeouts.clear();
      container.replaceChildren();
    },
  };
}

