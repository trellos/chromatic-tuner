// Jam Flow — mobile-first three-mode canvas UI for Wild Tuna
// Modes: Circle of Fifths → Key Zoom → Fretboard
// All canvas rendering + animated transitions live here.
// The note bar is HTML on the right edge.

// ── Color system ───────────────────────────────────────────────────────────
const COLOR_MUSTARD = "#cc9544";
const COLOR_ROSE = "#c45070";
const COLOR_WHITE = "#f0ece0";
const COLOR_BG = "#1a1c24";
const COLOR_NOTE_BAR_DEFAULT = "#5b32a0";

// ── Music theory ───────────────────────────────────────────────────────────

// Semitone index of each note C=0..B=11
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// Prefer flat spelling for display in certain contexts
const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

// Circle of fifths order: C G D A E B F# Db Ab Eb Bb F
const CIRCLE_ORDER = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

// Major scale intervals (semitones from root)
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

// Chord qualities for each scale degree
const DEGREE_QUALITIES = ["major", "minor", "minor", "major", "major", "minor", "diminished"];

// Roman numeral labels
const DEGREE_ROMAN = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];

// Petal counts per degree tier
const DEGREE_PETAL_COUNTS = [18, 14, 14, 16, 16, 14, 10];
// 0=I, 1=ii, 2=iii, 3=IV, 4=V, 5=vi, 6=vii°

type DegreeIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Color for each degree (colorA, colorB for alternating)
function degreeColors(deg: DegreeIndex): { colorA: string; colorB?: string } {
  // I → mustard solid
  if (deg === 0) return { colorA: COLOR_MUSTARD };
  // ii → white solid
  if (deg === 1) return { colorA: COLOR_WHITE };
  // iii → rose solid
  if (deg === 2) return { colorA: COLOR_ROSE };
  // IV → rose/white alternating (leads to iii)
  if (deg === 3) return { colorA: COLOR_ROSE, colorB: COLOR_WHITE };
  // V → white solid
  if (deg === 4) return { colorA: COLOR_WHITE };
  // vi → white solid
  if (deg === 5) return { colorA: COLOR_WHITE };
  // vii° → mustard/white alternating (leads to I)
  return { colorA: COLOR_MUSTARD, colorB: COLOR_WHITE };
}

// Is this degree a leading tone (alternating petal)?
function isLeadingTone(deg: DegreeIndex): boolean {
  return deg === 3 || deg === 6;
}

// Note bar degree-color
function noteBarColor(deg: DegreeIndex): { bg: string; border?: string; text: string } {
  if (deg === 0) return { bg: COLOR_MUSTARD, text: "#1a1c24" };
  if (deg === 1) return { bg: COLOR_WHITE, text: "#1a1c24" };
  if (deg === 2) return { bg: COLOR_ROSE, text: COLOR_WHITE };
  if (deg === 3) return { bg: COLOR_WHITE, border: COLOR_ROSE, text: "#1a1c24" }; // IV leading
  if (deg === 4) return { bg: COLOR_WHITE, text: "#1a1c24" };
  if (deg === 5) return { bg: COLOR_WHITE, text: "#1a1c24" };
  return { bg: COLOR_WHITE, border: COLOR_MUSTARD, text: "#1a1c24" }; // vii° leading
}

// Prettier chord name for display
function chordName(semitone: number, quality: string): string {
  const base = NOTE_NAMES_FLAT[semitone % 12] ?? "?";
  if (quality === "minor") return base + "m";
  if (quality === "diminished") return base + "°";
  return base;
}

export type DiatonicChord = {
  semitone: number;
  noteName: string;
  chordName: string;
  quality: string;
  degreeIndex: DegreeIndex;
  roman: string;
  colorA: string;
  colorB: string | undefined;
  petalCount: number;
};

export function getDiatonicChords(rootSemitone: number): DiatonicChord[] {
  return MAJOR_INTERVALS.map((interval, i) => {
    const semitone = (rootSemitone + interval) % 12;
    const deg = i as DegreeIndex;
    const quality = DEGREE_QUALITIES[i]!;
    const colors = degreeColors(deg);
    return {
      semitone,
      noteName: NOTE_NAMES_FLAT[semitone] ?? "?",
      chordName: chordName(semitone, quality),
      quality,
      degreeIndex: deg,
      roman: DEGREE_ROMAN[i]!,
      colorA: colors.colorA,
      colorB: colors.colorB,
      petalCount: DEGREE_PETAL_COUNTS[i]!,
    };
  });
}

// ── Easing ─────────────────────────────────────────────────────────────────

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// ── Color lerp ─────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r!, g!, b!];
}

function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar! + (br! - ar!) * t);
  const g = Math.round(ag! + (bg! - ag!) * t);
  const bv = Math.round(ab! + (bb! - ab!) * t);
  return `rgb(${r},${g},${bv})`;
}

// ── Kiku renderer ──────────────────────────────────────────────────────────

// Draws a single kiku (chrysanthemum) flower on a canvas context.
// colorB: if provided, alternate petals use colorB (for leading tones).
// labelTop: bold chord name, labelBot: smaller roman numeral.
function drawKiku(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  numPetals: number,
  colorA: string,
  colorB?: string,
  labelTop?: string,
  labelBot?: string,
  opacity = 1
): void {
  if (opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = opacity;

  for (let i = 0; i < numPetals; i++) {
    const angle = (i * (2 * Math.PI)) / numPetals - Math.PI / 2;
    const perpAngle = angle + Math.PI / 2;

    const tipDist = radius * 0.92;
    const neckDist = radius * 0.15;
    const neckHalf = radius * 0.045;
    const tipHalf = ((Math.PI / numPetals) * tipDist * 0.88) / 2;

    // Neck points (near center)
    const nx1 = cx + Math.cos(angle) * neckDist + Math.cos(perpAngle) * neckHalf;
    const ny1 = cy + Math.sin(angle) * neckDist + Math.sin(perpAngle) * neckHalf;
    const nx2 = cx + Math.cos(angle) * neckDist - Math.cos(perpAngle) * neckHalf;
    const ny2 = cy + Math.sin(angle) * neckDist - Math.sin(perpAngle) * neckHalf;

    // Tip point
    const tx = cx + Math.cos(angle) * tipDist;
    const ty = cy + Math.sin(angle) * tipDist;

    // Wide body points (at ~65% of radius)
    const bodyDist = radius * 0.65;
    const bx1 = cx + Math.cos(angle) * bodyDist + Math.cos(perpAngle) * tipHalf;
    const by1 = cy + Math.sin(angle) * bodyDist + Math.sin(perpAngle) * tipHalf;
    const bx2 = cx + Math.cos(angle) * bodyDist - Math.cos(perpAngle) * tipHalf;
    const by2 = cy + Math.sin(angle) * bodyDist - Math.sin(perpAngle) * tipHalf;

    ctx.beginPath();
    ctx.moveTo(nx1, ny1);
    ctx.quadraticCurveTo(bx1, by1, tx, ty);
    ctx.quadraticCurveTo(bx2, by2, nx2, ny2);
    ctx.closePath();

    const fillColor = colorB && i % 2 === 1 ? colorB : colorA;
    ctx.fillStyle = fillColor;
    ctx.fill();
  }

  // Center circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = colorA;
  ctx.fill();

  // Labels
  if (labelTop) {
    const textColor = colorA === COLOR_ROSE || colorA === COLOR_MUSTARD
      ? (colorA === COLOR_MUSTARD ? "#1a1c24" : COLOR_WHITE)
      : "#1a1c24";
    ctx.fillStyle = textColor;
    const fontSize = Math.max(8, Math.round(radius * 0.32));
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labelY = labelBot ? cy - radius * 0.06 : cy;
    ctx.fillText(labelTop, cx, labelY);
  }
  if (labelBot) {
    const textColor = colorA === COLOR_ROSE ? COLOR_WHITE : "#1a1c24";
    ctx.fillStyle = textColor;
    ctx.globalAlpha = opacity * 0.65;
    const subSize = Math.max(6, Math.round(radius * 0.22));
    ctx.font = `${subSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(labelBot, cx, cy + radius * 0.26);
  }

  ctx.restore();
}

// ── Layout helpers ─────────────────────────────────────────────────────────

type Pos = { x: number; y: number; r: number };

// Computes 12 circle-of-fifths positions within (availW x availH)
function layoutCircle(availW: number, availH: number): Pos[] {
  const cx = availW / 2;
  const cy = availH / 2;
  const maxR = Math.min(availW, availH) * 0.5 * 0.82;
  const flowerR = maxR * 0.28;
  const circleR = maxR - flowerR;

  return CIRCLE_ORDER.map((_, i) => {
    const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
    return {
      x: cx + Math.cos(angle) * circleR,
      y: cy + Math.sin(angle) * circleR,
      r: flowerR,
    };
  });
}

// Tier layout for Key Zoom: outer (IV, I, V), middle (ii, iii, vi), inner (vii°)
// Degree order in output: [I(0), ii(1), iii(2), IV(3), V(4), vi(5), vii°(6)]
// Position index: 0=I, 1=ii, 2=iii, 3=IV, 4=V, 5=vi, 6=vii°
function layoutKeyZoom(availW: number, availH: number): Pos[] {
  // Ideal layout in normalized coords (0..1), centered
  const margin = 0.04;
  const usableW = availW * (1 - 2 * margin);
  const usableH = availH * (1 - 2 * margin);
  const ox = availW * margin;
  const oy = availH * margin;

  // Heights of 3 tiers
  const tier1H = usableH * 0.40;
  const tier2H = usableH * 0.35;
  const tier3H = usableH * 0.25;

  const tier1Y = oy + tier1H * 0.5;
  const tier2Y = oy + tier1H + tier2H * 0.5;
  const tier3Y = oy + tier1H + tier2H + tier3H * 0.5;

  // Radii
  const rI = Math.min(usableW * 0.32, tier1H * 0.88) * 0.5;
  const rOuter = rI * 0.82;
  const rMid = rI * 0.66;
  const rInner = rI * 0.52;

  // X positions
  const midX = ox + usableW * 0.5;
  const leftX = midX - usableW * 0.32;
  const rightX = midX + usableW * 0.32;

  // Returns positions indexed as [I, ii, iii, IV, V, vi, vii°]
  return [
    { x: midX, y: tier1Y, r: rI },        // I (0) — center outer, largest
    { x: leftX, y: tier2Y, r: rMid },      // ii (1) — left middle
    { x: midX, y: tier2Y, r: rMid },       // iii (2) — center middle
    { x: leftX, y: tier1Y, r: rOuter },    // IV (3) — left outer
    { x: rightX, y: tier1Y, r: rOuter },   // V (4) — right outer
    { x: rightX, y: tier2Y, r: rMid },     // vi (5) — right middle
    { x: midX, y: tier3Y, r: rInner },     // vii° (6) — center inner
  ];
}

// ── Fretboard renderer ─────────────────────────────────────────────────────

// Standard guitar tuning: string 0 (leftmost) = E(4), 1=A(9), 2=D(2), 3=G(7), 4=B(11), 5=E(4)
const OPEN_STRING_SEMITONES = [4, 9, 2, 7, 11, 4];
const FRET_MARKERS_SINGLE = [3, 5, 7, 9];
const FRET_COUNT = 12;

type FretDot = {
  stringIndex: number;
  fret: number;
  semitone: number;
  degreeIndex: DegreeIndex;
  noteName: string;
};

function getFretboardDots(keySemitone: number): FretDot[] {
  const chords = getDiatonicChords(keySemitone);
  const diatonicSet = new Map<number, DiatonicChord>();
  for (const ch of chords) diatonicSet.set(ch.semitone, ch);

  const dots: FretDot[] = [];
  for (let s = 0; s < 6; s++) {
    for (let f = 0; f <= FRET_COUNT; f++) {
      const semitone = ((OPEN_STRING_SEMITONES[s]! + f) % 12);
      const chord = diatonicSet.get(semitone);
      if (chord) {
        dots.push({
          stringIndex: s,
          fret: f,
          semitone,
          degreeIndex: chord.degreeIndex,
          noteName: chord.noteName,
        });
      }
    }
  }
  return dots;
}

type FretboardLayout = {
  x: number; y: number; w: number; h: number;
  stringXs: number[];
  fretYs: number[];
  nutY: number;
  dotRadius: number;
};

function computeFretboardLayout(availW: number, availH: number, noteBarW: number): FretboardLayout {
  const pad = 8;
  const topPad = 28; // space for open string labels
  const x = pad;
  const y = topPad;
  const w = availW - noteBarW - pad * 2;
  const h = availH - topPad - pad;

  const stringSpacing = w / 5; // 6 strings, 5 gaps
  const fretSpacing = h / FRET_COUNT;

  const stringXs = Array.from({ length: 6 }, (_, i) => x + i * stringSpacing);
  const fretYs = Array.from({ length: FRET_COUNT + 1 }, (_, i) => y + i * fretSpacing);
  const nutY = fretYs[0]!;
  const dotRadius = Math.min(stringSpacing * 0.38, 12);

  return { x, y, w, h, stringXs, fretYs, nutY, dotRadius };
}

function drawFretboard(
  ctx: CanvasRenderingContext2D,
  layout: FretboardLayout,
  keySemitone: number | null,
  opacity: number,
  showDots: boolean
): void {
  if (opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = opacity;

  const { x, y, w, h, stringXs, fretYs, nutY, dotRadius } = layout;

  // Background panel
  ctx.fillStyle = "rgba(50, 56, 78, 0.15)";
  ctx.fillRect(x - 4, y, w + 8, h);

  // Fret lines
  for (let f = 0; f <= FRET_COUNT; f++) {
    const fy = fretYs[f]!;
    if (f === 0) {
      // Nut — thicker, teal
      ctx.strokeStyle = "rgba(0, 220, 190, 0.7)";
      ctx.lineWidth = 4;
    } else {
      ctx.strokeStyle = "rgba(180, 190, 220, 0.35)";
      ctx.lineWidth = 1;
    }
    ctx.beginPath();
    ctx.moveTo(stringXs[0]!, fy);
    ctx.lineTo(stringXs[5]!, fy);
    ctx.stroke();
  }

  // String lines
  for (let s = 0; s < 6; s++) {
    const sx = stringXs[s]!;
    const thickness = 0.8 + (5 - s) * 0.25; // thicker toward low strings
    ctx.strokeStyle = "rgba(180, 190, 220, 0.5)";
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(sx, nutY);
    ctx.lineTo(sx, fretYs[FRET_COUNT]!);
    ctx.stroke();
  }

  // Fret position markers
  const markerX = (stringXs[2]! + stringXs[3]!) / 2;
  for (const fret of FRET_MARKERS_SINGLE) {
    const fy = (fretYs[fret - 1]! + fretYs[fret]!) / 2;
    ctx.beginPath();
    ctx.arc(markerX, fy, 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(180, 190, 220, 0.25)";
    ctx.fill();
  }
  // 12th fret double dot
  {
    const fy = (fretYs[11]! + fretYs[12]!) / 2;
    for (const sx of [stringXs[1]!, stringXs[4]!]) {
      ctx.beginPath();
      ctx.arc(sx, fy, 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(180, 190, 220, 0.25)";
      ctx.fill();
    }
  }

  // Open string labels
  if (keySemitone !== null) {
    const chords = getDiatonicChords(keySemitone);
    const diatonicSet = new Map<number, DiatonicChord>();
    for (const ch of chords) diatonicSet.set(ch.semitone, ch);
    for (let s = 0; s < 6; s++) {
      const sem = OPEN_STRING_SEMITONES[s]!;
      const ch = diatonicSet.get(sem);
      const sx = stringXs[s]!;
      const labelY = y - 14;
      ctx.font = "bold 9px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (ch) {
        const colors = degreeColors(ch.degreeIndex);
        ctx.globalAlpha = opacity;
        ctx.fillStyle = colors.colorA;
        ctx.fillText(NOTE_NAMES_FLAT[sem]!, sx, labelY);
      } else {
        ctx.globalAlpha = opacity * 0.3;
        ctx.fillStyle = "#aaa";
        ctx.fillText(NOTE_NAMES_FLAT[sem]!, sx, labelY);
      }
    }
  }

  // Note dots
  if (showDots && keySemitone !== null) {
    const dots = getFretboardDots(keySemitone);
    for (const dot of dots) {
      const sx = stringXs[dot.stringIndex]!;
      const fy = dot.fret === 0
        ? nutY - dotRadius * 1.1  // open string: above nut
        : (fretYs[dot.fret - 1]! + fretYs[dot.fret]!) / 2;
      const r = dot.fret === 0 ? dotRadius * 0.7 : dotRadius;
      const colors = degreeColors(dot.degreeIndex);
      const leading = isLeadingTone(dot.degreeIndex);

      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.arc(sx, fy, r, 0, Math.PI * 2);
      if (leading) {
        ctx.fillStyle = COLOR_WHITE;
        ctx.fill();
        ctx.strokeStyle = colors.colorA;
        ctx.lineWidth = Math.max(2, r * 0.35);
        ctx.stroke();
      } else {
        ctx.fillStyle = colors.colorA;
        ctx.fill();
      }

      // Note name
      ctx.fillStyle = colors.colorA === COLOR_ROSE ? COLOR_WHITE : "#1a1c24";
      ctx.font = `bold ${Math.max(7, Math.round(r * 0.78))}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(dot.noteName, sx, fy);
    }
  }

  ctx.restore();
}

// ── Note bar ───────────────────────────────────────────────────────────────

type NoteBarHandle = {
  el: HTMLElement;
  update(keySemitone: number | null): void;
  destroy(): void;
};

const CHROMATIC_NOTES_DISPLAY = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
// Maps display index → semitone
const DISPLAY_TO_SEMITONE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function buildNoteBar(
  hostEl: HTMLElement,
  onTap: (semitone: number) => void
): NoteBarHandle {
  const el = document.createElement("div");
  el.className = "jf-note-bar";

  const btns: HTMLButtonElement[] = [];

  for (let i = 0; i < 12; i++) {
    const semitone = DISPLAY_TO_SEMITONE[i]!;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "jf-note-btn jf-note-btn--default";
    btn.textContent = CHROMATIC_NOTES_DISPLAY[i]!;
    btn.dataset.semitone = String(semitone);
    btn.addEventListener("click", () => onTap(semitone));
    btns.push(btn);
    el.appendChild(btn);
  }

  hostEl.appendChild(el);

  function update(keySemitone: number | null): void {
    if (keySemitone === null) {
      for (const btn of btns) {
        btn.className = "jf-note-btn jf-note-btn--default";
        btn.style.cssText = "";
      }
      return;
    }

    const chords = getDiatonicChords(keySemitone);
    const diatonicMap = new Map<number, DiatonicChord>();
    for (const ch of chords) diatonicMap.set(ch.semitone, ch);

    for (let i = 0; i < 12; i++) {
      const semitone = DISPLAY_TO_SEMITONE[i]!;
      const btn = btns[i]!;
      const ch = diatonicMap.get(semitone);

      if (!ch) {
        btn.className = "jf-note-btn jf-note-btn--nondiatonic";
        btn.style.cssText = "";
      } else if (isLeadingTone(ch.degreeIndex)) {
        const colors = noteBarColor(ch.degreeIndex);
        btn.className = "jf-note-btn jf-note-btn--leading";
        btn.style.backgroundColor = colors.bg;
        btn.style.borderColor = colors.border ?? "transparent";
        btn.style.color = colors.text;
      } else {
        const colors = noteBarColor(ch.degreeIndex);
        btn.className = "jf-note-btn jf-note-btn--diatonic";
        btn.style.backgroundColor = colors.bg;
        btn.style.borderColor = "transparent";
        btn.style.color = colors.text;
      }
    }
  }

  function destroy(): void {
    el.remove();
  }

  return { el, update, destroy };
}

// ── JamFlowUi ──────────────────────────────────────────────────────────────

type JamFlowMode = "circle" | "key-zoom" | "fretboard";

export type JamFlowOptions = {
  /** Tapped a circle flower → select this key and play */
  onKeySelect?: (semitone: number) => void;
  /** Tapped a note bar button */
  onNoteBarTap?: (semitone: number) => void;
  /** Tapped a fretboard dot */
  onFretDotTap?: (midi: number, stringIndex: number) => void;
};

export type JamFlowUi = {
  enter(): void;
  exit(): void;
  /** Visual pulse on the currently visible display (circle or key zoom) */
  pulseNote(midi: number, durationMs: number): void;
  pulseChord(midis: number[], durationMs: number): void;
  /** Visual pulse on fretboard dots */
  pulseTargets(targets: Array<{ midi: number; stringIndex: number }>, durationMs: number): void;
  destroy(): void;
};

const NOTE_BAR_W = 44;

export function createJamFlowUi(hostEl: HTMLElement, options: JamFlowOptions = {}): JamFlowUi {
  // Build DOM structure
  const wrapper = document.createElement("div");
  wrapper.className = "jf-wrapper";

  const canvasWrapper = document.createElement("div");
  canvasWrapper.className = "jf-canvas-wrapper";

  const canvas = document.createElement("canvas");
  canvas.className = "jf-canvas";
  canvasWrapper.appendChild(canvas);
  wrapper.appendChild(canvasWrapper);

  const noteBarHost = document.createElement("div");
  noteBarHost.className = "jf-note-bar-host";
  wrapper.appendChild(noteBarHost);

  hostEl.appendChild(wrapper);

  const ctx = canvas.getContext("2d")!;

  // State
  let currentMode: JamFlowMode = "circle";
  let selectedKey: number | null = null;
  let rafId: number | null = null;
  let transitionActive = false;
  let transitionStart = 0;
  let transitionDuration = 500;
  let transitionFrom: JamFlowMode = "circle";
  let transitionTo: JamFlowMode = "key-zoom";
  let transitionForward = true; // true = forward, false = reverse

  // Pulse state: a list of active pulse rings
  type Pulse = { x: number; y: number; r: number; startT: number; durationMs: number; color: string };
  const pulses: Pulse[] = [];

  // Dot pulse state (fretboard)
  type DotPulse = { stringIndex: number; fret: number; startT: number; durationMs: number };
  const dotPulses: DotPulse[] = [];

  // Note bar
  const noteBar = buildNoteBar(noteBarHost, (semitone) => {
    options.onNoteBarTap?.(semitone);
    if (transitionActive) return;
    if (currentMode === "key-zoom") {
      startTransition("key-zoom", "fretboard", true);
    } else if (currentMode === "fretboard") {
      startTransition("fretboard", "key-zoom", false);
    }
  });

  function getDimensions() {
    // Measure the canvas wrapper directly — it is already sized to exclude the
    // note bar by virtue of the flex layout, and its dimensions are stable once
    // the grid has painted (unlike hostEl which may report 0 before fullscreen).
    const rect = canvasWrapper.getBoundingClientRect();
    const w = rect.width || canvasWrapper.clientWidth;
    const h = rect.height || canvasWrapper.clientHeight;
    return { w, h };
  }

  function resizeCanvas() {
    const { w, h } = getDimensions();
    // Guard: skip drawing entirely until the element has real dimensions.
    if (w <= 0 || h <= 0) return { w: 0, h: 0 };
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.floor(w * dpr);
    const ch = Math.floor(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    return { w, h };
  }

  // ── Cached layouts ────────────────────────────────────────────────────────

  let cachedW = 0;
  let cachedH = 0;
  let circlePositions: Pos[] = [];
  let keyZoomPositions: Pos[] = [];
  let fretboardLayout: FretboardLayout | null = null;

  function rebuildLayouts(w: number, h: number) {
    if (w === cachedW && h === cachedH) return;
    cachedW = w;
    cachedH = h;
    circlePositions = layoutCircle(w, h);
    keyZoomPositions = layoutKeyZoom(w, h);
    fretboardLayout = computeFretboardLayout(w, h, 0);
  }

  // ── Tap detection ──────────────────────────────────────────────────────────

  function handleCanvasTap(evt: PointerEvent) {
    if (transitionActive) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const mx = (evt.clientX - rect.left);
    const my = (evt.clientY - rect.top);
    const { w, h } = resizeCanvas();
    rebuildLayouts(w, h);

    if (currentMode === "circle") {
      // Find which flower was tapped
      for (let i = 0; i < 12; i++) {
        const pos = circlePositions[i]!;
        const dx = mx - pos.x;
        const dy = my - pos.y;
        if (dx * dx + dy * dy <= pos.r * pos.r) {
          const semitone = CIRCLE_ORDER[i]!;
          selectedKey = semitone;
          noteBar.update(semitone);
          options.onKeySelect?.(semitone);
          startTransition("circle", "key-zoom", true);
          return;
        }
      }
    } else if (currentMode === "key-zoom") {
      // Tap background → back to circle
      startTransition("key-zoom", "circle", false);
    } else if (currentMode === "fretboard" && fretboardLayout && selectedKey !== null) {
      // Tap a dot
      const dots = getFretboardDots(selectedKey);
      for (const dot of dots) {
        const sx = fretboardLayout.stringXs[dot.stringIndex]!;
        const fy = dot.fret === 0
          ? fretboardLayout.nutY - fretboardLayout.dotRadius * 1.1
          : (fretboardLayout.fretYs[dot.fret - 1]! + fretboardLayout.fretYs[dot.fret]!) / 2;
        const r = fretboardLayout.dotRadius * (dot.fret === 0 ? 0.7 : 1);
        const dx = mx - sx;
        const dy = my - fy;
        if (dx * dx + dy * dy <= r * r * 1.4) {
          const midi = dot.semitone + 48; // rough MIDI mapping
          options.onFretDotTap?.(midi, dot.stringIndex);
          addDotPulse(dot.stringIndex, dot.fret);
          return;
        }
      }
    }
  }

  canvas.addEventListener("pointerup", handleCanvasTap);

  // ── Transitions ────────────────────────────────────────────────────────────

  function startTransition(from: JamFlowMode, to: JamFlowMode, forward: boolean) {
    if (transitionActive) return;
    transitionActive = true;
    transitionFrom = from;
    transitionTo = to;
    transitionForward = forward;
    transitionStart = performance.now();
    transitionDuration = 500;
  }

  function finishTransition() {
    currentMode = transitionTo;
    transitionActive = false;
  }

  // ── Pulses ─────────────────────────────────────────────────────────────────

  function addPulseAtCanvas(x: number, y: number, r: number, color: string, durationMs: number) {
    pulses.push({ x, y, r, startT: performance.now(), durationMs, color });
  }

  function addDotPulse(stringIndex: number, fret: number) {
    dotPulses.push({ stringIndex, fret, startT: performance.now(), durationMs: 500 });
  }

  function semitoneToCirclePos(semitone: number): Pos | null {
    const idx = CIRCLE_ORDER.indexOf(semitone);
    if (idx < 0 || !circlePositions[idx]) return null;
    return circlePositions[idx]!;
  }

  function semitoneToKeyZoomPos(semitone: number): Pos | null {
    if (selectedKey === null) return null;
    const chords = getDiatonicChords(selectedKey);
    const chord = chords.find((c) => c.semitone === semitone);
    if (!chord) return null;
    return keyZoomPositions[chord.degreeIndex] ?? null;
  }

  // ── Draw loop ──────────────────────────────────────────────────────────────

  function drawFrame() {
    const { w, h } = resizeCanvas();
    if (w <= 0 || h <= 0) {
      rafId = requestAnimationFrame(drawFrame);
      return;
    }
    rebuildLayouts(w, h);
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    const now = performance.now();
    const elapsed = now - transitionStart;
    const rawT = Math.min(1, elapsed / transitionDuration);
    const easedT = easeInOut(rawT);

    if (!transitionActive) {
      drawStaticMode(currentMode, w, h);
    } else {
      drawTransition(transitionFrom, transitionTo, transitionForward, easedT, w, h);
      if (rawT >= 1) finishTransition();
    }

    // Pulses
    drawPulses(now);

    ctx.restore();
    rafId = requestAnimationFrame(drawFrame);
  }

  function drawStaticMode(mode: JamFlowMode, w: number, h: number) {
    if (mode === "circle") {
      drawCircleMode(w, h, 1);
    } else if (mode === "key-zoom") {
      if (selectedKey !== null) {
        drawFretboard(ctx, fretboardLayout!, selectedKey, 0.2, false);
        drawKeyZoomMode(w, h, 1);
      }
    } else if (mode === "fretboard") {
      if (fretboardLayout) {
        drawFretboard(ctx, fretboardLayout, selectedKey, 1, true);
      }
    }
  }

  function drawCircleMode(w: number, h: number, opacity: number) {
    const cx = w / 2;
    const cy = h / 2;

    // Center text
    ctx.save();
    ctx.globalAlpha = opacity * 0.18;
    ctx.fillStyle = COLOR_WHITE;
    const fontSize = Math.max(8, Math.min(12, w * 0.028));
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Rotated text
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("ACOUSTIC GUITAR", 0, 0);
    ctx.restore();

    for (let i = 0; i < 12; i++) {
      const pos = circlePositions[i]!;
      const semitone = CIRCLE_ORDER[i]!;
      const label = NOTE_NAMES_FLAT[semitone]!;
      drawKiku(ctx, pos.x, pos.y, pos.r, 14, COLOR_WHITE, undefined, label, undefined, opacity);
    }
  }

  function drawKeyZoomMode(w: number, h: number, opacity: number) {
    if (selectedKey === null) return;
    const chords = getDiatonicChords(selectedKey);

    // Draw order (back to front): vii°(6) → ii(1) → iii(2) → vi(5) → IV(3) → V(4) → I(0)
    const drawOrder: DegreeIndex[] = [6, 1, 2, 5, 3, 4, 0];
    for (const deg of drawOrder) {
      const chord = chords[deg]!;
      const pos = keyZoomPositions[deg]!;
      drawKiku(
        ctx, pos.x, pos.y, pos.r,
        chord.petalCount,
        chord.colorA,
        chord.colorB,
        chord.chordName,
        chord.roman,
        opacity
      );
    }
  }

  // Transition: circle ↔ key-zoom
  function drawCircleToKeyZoom(t: number, w: number, h: number) {
    if (selectedKey === null) return;
    const chords = getDiatonicChords(selectedKey);

    const diatonicSemitones = new Set(chords.map((c) => c.semitone));

    // Ghost fretboard fades in
    if (fretboardLayout) {
      drawFretboard(ctx, fretboardLayout, selectedKey, t * 0.2, false);
    }

    // Non-diatonic flowers fade out
    for (let i = 0; i < 12; i++) {
      const semitone = CIRCLE_ORDER[i]!;
      if (!diatonicSemitones.has(semitone)) {
        const pos = circlePositions[i]!;
        drawKiku(ctx, pos.x, pos.y, pos.r, 14, COLOR_WHITE, undefined,
          NOTE_NAMES_FLAT[semitone], undefined, 1 - t);
      }
    }

    // Diatonic flowers glide from circle positions to key-zoom positions
    const drawOrder: DegreeIndex[] = [6, 1, 2, 5, 3, 4, 0];
    for (const deg of drawOrder) {
      const chord = chords[deg]!;
      const circleIdx = CIRCLE_ORDER.indexOf(chord.semitone);
      const cPos = circlePositions[circleIdx] ?? keyZoomPositions[deg]!;
      const kPos = keyZoomPositions[deg]!;

      const x = cPos.x + (kPos.x - cPos.x) * t;
      const y = cPos.y + (kPos.y - cPos.y) * t;
      const r = cPos.r + (kPos.r - cPos.r) * t;

      // Petal color lerp from white to degree color
      const colorA = lerpColor(COLOR_WHITE, chord.colorA, t);
      const colorB = chord.colorB ? lerpColor(COLOR_WHITE, chord.colorB, t) : undefined;

      // Labels appear partway through
      const showLabel = t > 0.3;
      const showRoman = t > 0.5;
      const labelOpacity = showLabel ? Math.min(1, (t - 0.3) / 0.3) : 0;

      const petalCount = t < 0.3 ? 14 : chord.petalCount;

      ctx.save();
      ctx.globalAlpha = labelOpacity;
      drawKiku(ctx, x, y, r, petalCount, colorA, colorB,
        showLabel ? chord.chordName : undefined,
        showRoman ? chord.roman : undefined,
        1);
      ctx.restore();

      // Draw without labels at full opacity underneath
      if (!showLabel) {
        drawKiku(ctx, x, y, r, petalCount, colorA, colorB, undefined, undefined, 1);
      }
    }

    // Center text fades out
    const cx = w / 2;
    const cy = h / 2;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.18;
    ctx.fillStyle = COLOR_WHITE;
    const fontSize = Math.max(8, Math.min(12, w * 0.028));
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("ACOUSTIC GUITAR", 0, 0);
    ctx.restore();
  }

  // Transition: key-zoom ↔ fretboard
  function drawKeyZoomToFretboard(t: number, w: number, h: number) {
    if (selectedKey === null || !fretboardLayout) return;
    const chords = getDiatonicChords(selectedKey);

    // Fretboard brightens from ghost (0.2) to full
    const fretOpacity = 0.2 + t * 0.8;
    drawFretboard(ctx, fretboardLayout, selectedKey, fretOpacity, t > 0.5);

    // Kiku flowers fade out
    const flowerOpacity = 1 - t;
    if (flowerOpacity > 0) {
      const drawOrder: DegreeIndex[] = [6, 1, 2, 5, 3, 4, 0];
      for (const deg of drawOrder) {
        const chord = chords[deg]!;
        const pos = keyZoomPositions[deg]!;
        drawKiku(ctx, pos.x, pos.y, pos.r, chord.petalCount,
          chord.colorA, chord.colorB, chord.chordName, chord.roman, flowerOpacity);
      }
    }

    // Dots animate from their source flower center to fretboard position
    if (t > 0 && t <= 1) {
      const dots = getFretboardDots(selectedKey);
      for (const dot of dots) {
        const ch = chords.find((c) => c.semitone === dot.semitone);
        if (!ch) continue;
        const srcPos = keyZoomPositions[ch.degreeIndex] ?? { x: w / 2, y: h / 2 };

        const sx = fretboardLayout.stringXs[dot.stringIndex]!;
        const fy = dot.fret === 0
          ? fretboardLayout.nutY - fretboardLayout.dotRadius * 1.1
          : (fretboardLayout.fretYs[dot.fret - 1]! + fretboardLayout.fretYs[dot.fret]!) / 2;

        const dotX = srcPos.x + (sx - srcPos.x) * t;
        const dotY = srcPos.y + (fy - srcPos.y) * t;
        const r = 2 + (fretboardLayout.dotRadius - 2) * t;
        const dotOpacity = t;
        const colors = degreeColors(ch.degreeIndex);
        const leading = isLeadingTone(ch.degreeIndex);

        ctx.save();
        ctx.globalAlpha = dotOpacity;
        ctx.beginPath();
        ctx.arc(dotX, dotY, r, 0, Math.PI * 2);
        if (leading) {
          ctx.fillStyle = COLOR_WHITE;
          ctx.fill();
          ctx.strokeStyle = colors.colorA;
          ctx.lineWidth = Math.max(1.5, r * 0.35);
          ctx.stroke();
        } else {
          ctx.fillStyle = colors.colorA;
          ctx.fill();
        }
        if (t > 0.6 && r > 6) {
          ctx.fillStyle = colors.colorA === COLOR_ROSE ? COLOR_WHITE : "#1a1c24";
          ctx.font = `bold ${Math.max(7, Math.round(r * 0.78))}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.globalAlpha = (t - 0.6) / 0.4 * dotOpacity;
          ctx.fillText(dot.noteName, dotX, dotY);
        }
        ctx.restore();
      }
    }
  }

  function drawTransition(
    from: JamFlowMode, to: JamFlowMode, forward: boolean,
    easedT: number, w: number, h: number
  ) {
    const t = forward ? easedT : 1 - easedT;

    if ((from === "circle" && to === "key-zoom") || (from === "key-zoom" && to === "circle")) {
      drawCircleToKeyZoom(t, w, h);
    } else if ((from === "key-zoom" && to === "fretboard") || (from === "fretboard" && to === "key-zoom")) {
      drawKeyZoomToFretboard(t, w, h);
    }
  }

  function drawPulses(now: number) {
    const alive: Pulse[] = [];
    for (const p of pulses) {
      const age = now - p.startT;
      if (age > p.durationMs) continue;
      const t = age / p.durationMs;
      const r = p.r * (1 + t * 0.4);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
      alive.push(p);
    }
    pulses.length = 0;
    pulses.push(...alive);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  let running = false;

  function enter() {
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(drawFrame);
    window.addEventListener("resize", onResize);
  }

  function exit() {
    running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    window.removeEventListener("resize", onResize);
  }

  function onResize() {
    cachedW = 0; cachedH = 0; // force re-layout
  }

  function pulseNote(midi: number, durationMs: number) {
    const semitone = midi % 12;
    const { w, h } = resizeCanvas();
    rebuildLayouts(w, h);

    let pos: Pos | null = null;
    if (currentMode === "circle" || (transitionActive && transitionFrom === "circle")) {
      pos = semitoneToCirclePos(semitone);
    } else if (currentMode === "key-zoom" || (transitionActive && transitionFrom === "key-zoom")) {
      pos = semitoneToKeyZoomPos(semitone);
    }
    if (pos) {
      const ch = selectedKey !== null
        ? getDiatonicChords(selectedKey).find((c) => c.semitone === semitone)
        : null;
      addPulseAtCanvas(pos.x, pos.y, pos.r, ch?.colorA ?? COLOR_WHITE, durationMs);
    }
  }

  function pulseChord(midis: number[], durationMs: number) {
    for (const midi of midis) pulseNote(midi, durationMs);
  }

  function pulseTargets(targets: Array<{ midi: number; stringIndex: number }>, durationMs: number) {
    for (const t of targets) {
      const semitone = t.midi % 12;
      if (fretboardLayout) {
        // Find matching dot position
        const sx = fretboardLayout.stringXs[t.stringIndex];
        if (sx !== undefined && selectedKey !== null) {
          const dots = getFretboardDots(selectedKey);
          const match = dots.find((d) => d.stringIndex === t.stringIndex && d.semitone === semitone);
          if (match) {
            const fy = match.fret === 0
              ? fretboardLayout.nutY - fretboardLayout.dotRadius * 1.1
              : (fretboardLayout.fretYs[match.fret - 1]! + fretboardLayout.fretYs[match.fret]!) / 2;
            const r = fretboardLayout.dotRadius;
            addPulseAtCanvas(sx, fy, r, COLOR_WHITE, durationMs);
          }
        }
      }
    }
  }

  function destroy() {
    exit();
    canvas.removeEventListener("pointerup", handleCanvasTap);
    noteBar.destroy();
    wrapper.remove();
  }

  return { enter, exit, pulseNote, pulseChord, pulseTargets, destroy };
}
