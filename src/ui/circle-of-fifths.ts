export type CircleQuality = "minor" | "diminished";

export type CircleChordSpec = {
  label: string;
  rootMidi: number;
  quality: CircleQuality;
};

export type CircleLegend = {
  degreeText: string;
  chordToneText: string;
};

export type CircleSelection = {
  primaryLabel: string;
  primaryMidi: number;
  secondaryChords: CircleChordSpec[];
  diminishedChord: CircleChordSpec;
  legend: CircleLegend;
};

export type CircleOfFifthsUiOptions = {
  onPrimaryTap?: (selection: CircleSelection) => void;
  onSecondaryTap?: (chord: CircleChordSpec) => void;
  onOuterTap?: (note: CircleNoteTap) => void;
  onOuterDoubleTap?: (note: CircleNoteTap) => void;
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
const LEGEND_OUTER_RADIUS = 170;
const LEGEND_INNER_RADIUS = 106;

const OUTER_WEDGE_DEG = 30;
// Keep inner wedge spans equal to outer wedge spans so radial boundaries line up across rings.
const SECONDARY_WEDGE_DEG = 30;
const DIM_WEDGE_DEG = 30;
const LEGEND_WEDGE_DEG = 30;

const SECONDARY_CENTERS = [-30, 0, 30] as const;
const SECONDARY_INTERVALS = [2, 4, 9] as const; // II, III, VI
const MAJOR_TRIAD_INTERVALS = [0, 4, 7] as const;

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

  const chordToneText = MAJOR_TRIAD_INTERVALS.map((interval) => {
    const semitone = wrapSemitone(primary.semitone + interval);
    return noteLabelFromSemitone(semitone, preferFlats);
  }).join("-");

  return {
    primaryLabel: primary.label,
    primaryMidi: midiFromSemitoneNearC4(primary.semitone),
    secondaryChords,
    diminishedChord,
    legend: {
      degreeText: "II III VI · VII°",
      chordToneText,
    },
  };
}

export function getCircleChordMidis(chord: CircleChordSpec): number[] {
  if (chord.quality === "diminished") {
    return [chord.rootMidi, chord.rootMidi + 3, chord.rootMidi + 6];
  }
  return [chord.rootMidi, chord.rootMidi + 3, chord.rootMidi + 7];
}

export function getCircleMajorChordMidis(rootMidi: number): number[] {
  return [rootMidi, rootMidi + 4, rootMidi + 7];
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
  const legendGroup = createSvgEl("g", "cof-legend");

  svg.appendChild(outerGroup);
  detailGroup.appendChild(secondaryGroup);
  detailGroup.appendChild(dimGroup);
  detailGroup.appendChild(legendGroup);
  svg.appendChild(detailGroup);
  root.appendChild(svg);
  container.replaceChildren(root);

  let primaryIndex: number | null = null;
  let selection: CircleSelection | null = null;
  let chordModeEnabled = false;
  let detuneDeg = 0;

  const updateOuterChordModeLabels = (): void => {
    root.classList.toggle("is-chord-mode", chordModeEnabled);
    outerButtons.forEach((button, index) => {
      const note = OUTER_NOTES[index];
      const label = button.querySelector<SVGTextElement>(".cof-wedge-label");
      if (!note || !label) return;

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

  const applyDetailTransform = (): void => {
    const baseDeg = primaryIndex === null ? 0 : primaryIndex * OUTER_WEDGE_DEG;
    detailGroup.style.transform = `rotate(${(baseDeg + detuneDeg).toFixed(2)}deg)`;
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

    const emitOuterTap = (): CircleNoteTap => ({
      index,
      label: note.label,
      midi: midiFromSemitoneNearC4(note.semitone),
      isPrimary: index === primaryIndex,
    });

    const onActivate = (): void => {
      const tap = emitOuterTap();
      options.onOuterTap?.(tap);
      if (chordModeEnabled) return;
      setPrimaryIndex(index);
      if (selection) options.onPrimaryTap?.(selection);
    };

    node.addEventListener("click", onActivate);
    node.addEventListener("dblclick", (event) => {
      event.preventDefault();
      const tap = emitOuterTap();
      options.onOuterDoubleTap?.(tap);
    });
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onActivate();
    });

    outerGroup.appendChild(node);
    return node;
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
      if (chord) options.onSecondaryTap?.(chord);
    });
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const chord = selection?.secondaryChords[cellIndex];
      if (chord) options.onSecondaryTap?.(chord);
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

  legendGroup.setAttribute("data-center-deg", "0");
  legendGroup.setAttribute("data-span-deg", String(LEGEND_WEDGE_DEG));

  const legendPath = createSvgEl("path", "cof-legend-path");
  legendPath.setAttribute("d", describeAnnularSector(LEGEND_INNER_RADIUS, LEGEND_OUTER_RADIUS, 0, LEGEND_WEDGE_DEG));
  legendGroup.appendChild(legendPath);

  const legendCenter = polarPoint((LEGEND_OUTER_RADIUS + LEGEND_INNER_RADIUS) / 2, 0);
  const legendDegrees = createSvgEl("text", "cof-legend-line cof-legend-line--degrees");
  legendDegrees.setAttribute("x", String(legendCenter.x));
  legendDegrees.setAttribute("y", String(legendCenter.y - 12));
  legendGroup.appendChild(legendDegrees);

  const legendChordTones = createSvgEl("text", "cof-legend-line cof-legend-line--tones");
  legendChordTones.setAttribute("x", String(legendCenter.x));
  legendChordTones.setAttribute("y", String(legendCenter.y + 12));
  legendGroup.appendChild(legendChordTones);

  const setPrimaryIndex = (nextPrimaryIndex: number | null): void => {
    primaryIndex = nextPrimaryIndex;
    selection = nextPrimaryIndex === null ? null : getSelectionFromPrimary(nextPrimaryIndex);

    outerButtons.forEach((button, index) => {
      const isPrimary = index === primaryIndex;
      button.classList.toggle("is-primary", isPrimary);
      button.setAttribute("aria-pressed", isPrimary ? "true" : "false");
    });

    if (!selection || primaryIndex === null) {
      root.classList.remove("has-primary");
      detuneDeg = 0;
      applyDetailTransform();
      return;
    }

    const activeSelection = selection;
    if (!activeSelection) return;

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

    legendDegrees.textContent = activeSelection.legend.degreeText;
    legendChordTones.textContent = activeSelection.legend.chordToneText;
  };

  dimNode.addEventListener("click", () => {
    if (selection) options.onSecondaryTap?.(selection.diminishedChord);
  });
  dimNode.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (selection) options.onSecondaryTap?.(selection.diminishedChord);
  });

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
      container.replaceChildren();
    },
  };
}
