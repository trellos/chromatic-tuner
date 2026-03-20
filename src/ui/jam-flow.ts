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

// Roman numeral labels (major scale — used for the I chord and direct major-mode display)
const DEGREE_ROMAN = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];

// Upper- and lower-case numerals (without quality suffix) for relative-mode labels
const DEGREE_ROMAN_UPPER = ["I", "II", "III", "IV", "V", "VI", "VII"];
const DEGREE_ROMAN_LOWER = ["i", "ii", "iii", "iv", "v", "vi", "vii"];

// Roman numeral for a chord at `effDeg` position whose actual quality is `quality`.
// Used when a relative root is active so the numeral reflects the mode's chord qualities.
function relativeRoman(effDeg: number, quality: string): string {
  if (quality === "major") return DEGREE_ROMAN_UPPER[effDeg]!;
  if (quality === "diminished") return DEGREE_ROMAN_LOWER[effDeg]! + "°";
  return DEGREE_ROMAN_LOWER[effDeg]!; // minor
}

// Petal counts per degree tier
const DEGREE_PETAL_COUNTS = [18, 14, 14, 16, 16, 14, 10];
// 0=I, 1=ii, 2=iii, 3=IV, 4=V, 5=vi, 6=vii°

// Modal name for each degree (used when a chord is double-tapped to become root)
const MODE_NAMES = ["major", "Dorian", "Phrygian", "Lydian", "Mixolydian", "minor", "Locrian"];

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

// Draws a single kiku (chrysanthemum) flower.
// Petals are ellipses whose inner tip converges at the flower centre (no
// explicit centre circle — the converging tips create the appearance of one).
// colorB: if provided, alternate petals use colorB (leading-tone treatment).
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

  const angSlot = (2 * Math.PI) / numPetals;

  // Kiku crest proportions: narrow shaft widens to a rounded tip circle.
  const innerR = radius * 0.14;  // center circle radius
  const baseR  = radius * 0.22;  // where petals attach
  const tipCR  = radius * 0.87;  // tip circle center radius
  const tipR   = radius * 0.13;  // tip circle radius
  const baseHW = radius * 0.024; // half-width at inner base

  for (let i = 0; i < numPetals; i++) {
    const a  = i * angSlot - Math.PI / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const px = -sa, py = ca; // perpendicular (90° CCW from petal axis)

    const s1x = cx + baseR * ca + baseHW * px;
    const s1y = cy + baseR * sa + baseHW * py;
    const s2x = cx + baseR * ca - baseHW * px;
    const s2y = cy + baseR * sa - baseHW * py;

    const t1x = cx + tipCR * ca + tipR * px;
    const t1y = cy + tipCR * sa + tipR * py;
    const t2x = cx + tipCR * ca - tipR * px;
    const t2y = cy + tipCR * sa - tipR * py;

    const tipCX = cx + tipCR * ca;
    const tipCY = cy + tipCR * sa;

    ctx.beginPath();
    ctx.moveTo(s2x, s2y);
    ctx.lineTo(t2x, t2y);
    // Arc CW around outer tip (anticlockwise=false goes through outermost point)
    ctx.arc(tipCX, tipCY, tipR,
      Math.atan2(t2y - tipCY, t2x - tipCX),
      Math.atan2(t1y - tipCY, t1x - tipCX),
      false);
    ctx.lineTo(s1x, s1y);
    // Short CCW arc along base circle back to s2
    ctx.arc(cx, cy, baseR,
      Math.atan2(s1y - cy, s1x - cx),
      Math.atan2(s2y - cy, s2x - cx),
      true);
    ctx.closePath();
    ctx.fillStyle = colorB !== undefined && i % 2 === 1 ? colorB : colorA;
    ctx.fill();
  }

  // Center circle
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = colorA;
  ctx.fill();

  // Labels — drawn over the center circle; pick dark/light text by luminance.
  const [lr, lg, lb] = hexToRgb(colorA);
  const lum = 0.299 * lr! / 255 + 0.587 * lg! / 255 + 0.114 * lb! / 255;
  const textColor = lum > 0.5 ? "#1a1c24" : "#f0ece0";
  // Note letters: 66% of flower diameter = 1.32 × radius, Black weight.
  const mainSize = Math.max(12, Math.round(radius * 1.32));
  const subSize  = Math.max(9,  Math.round(radius * 0.72));

  if (labelTop) {
    ctx.globalAlpha = opacity;
    ctx.fillStyle = textColor;
    ctx.font = `900 ${mainSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labelY = labelBot ? cy - radius * 0.32 : cy;
    ctx.fillText(labelTop, cx, labelY);
  }
  if (labelBot) {
    ctx.fillStyle = textColor;
    ctx.globalAlpha = opacity * 0.72;
    ctx.font = `900 ${subSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(labelBot, cx, cy + radius * 0.46);
  }

  ctx.restore();
}

// ── Layout helpers ─────────────────────────────────────────────────────────

type Pos = { x: number; y: number; r: number };

// Computes 12 circle-of-fifths positions within (availW x availH).
// Flower centres follow a hexagonal path tilted by HEX_ROTATION so no vertex
// points straight up — a "rakish" angle that reduces the top/bottom span while
// keeping the characteristic hexagonal rhythm. The tilt also reduces the
// alternation between vertex (far) and face-centre (near) positions, producing
// a more even wreath with less overlap while retaining Japanese kamon character.
const HEX_ROTATION = Math.PI / 9; // 20° rakish tilt
function layoutCircle(availW: number, availH: number): Pos[] {
  const cx = availW / 2;
  const cy = availH / 2;
  // Slightly larger maxR to compensate for the rotation bringing all positions
  // closer to the inscribed-circle radius (net ~10% inward from the vertex).
  const maxR = Math.min(availW, availH) * 0.5 * 0.86;
  const flowerR = maxR * 0.21;
  const baseR = maxR - flowerR;

  return CIRCLE_ORDER.map((_, i) => {
    const angle = (i / 12) * 2 * Math.PI - Math.PI / 2;
    // Hexagonal radius at this angle, with the hex rotated by HEX_ROTATION.
    const hexAngle = angle + Math.PI / 2 + HEX_ROTATION;
    const seg = Math.PI / 3; // 60° per hex face
    const localAngle = ((hexAngle % seg) + seg) % seg - seg / 2; // −30° … +30°
    const hexR = baseR * Math.cos(Math.PI / 6) / Math.cos(localAngle);
    return {
      x: cx + Math.cos(angle) * hexR,
      y: cy + Math.sin(angle) * hexR,
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
// MIDI note numbers for open strings: E2=40, A2=45, D3=50, G3=55, B3=59, E4=64
const OPEN_STRING_MIDI = [40, 45, 50, 55, 59, 64];
const FRET_MARKERS_SINGLE = [3, 5, 7, 9];
const FRET_COUNT = 12;

type FretDot = {
  stringIndex: number;
  fret: number;
  semitone: number;
  midi: number;
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
          midi: OPEN_STRING_MIDI[s]! + f,
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

  // Golden-ratio cap: fretboard width ≤ height / φ so it always reads as vertical.
  const GOLDEN = 1.618;
  const fullW  = availW - noteBarW - pad * 2;
  const h      = availH - topPad - pad;
  const maxW   = Math.floor(h / GOLDEN);
  const w      = Math.round(Math.min(fullW, maxW));
  const xOff   = Math.round((fullW - w) / 2);
  const x      = pad + xOff;
  const y      = topPad;

  const stringSpacing = w / 5; // 6 strings, 5 gaps
  const fretSpacing = h / FRET_COUNT;

  const stringXs = Array.from({ length: 6 }, (_, i) => x + i * stringSpacing);
  const fretYs = Array.from({ length: FRET_COUNT + 1 }, (_, i) => y + i * fretSpacing);
  const nutY = fretYs[0]!;
  const dotRadius = Math.min(stringSpacing * 0.38, 12);

  return { x, y, w, h, stringXs, fretYs, nutY, dotRadius };
}

// Computes the octave zoom viewport for a double-tapped note.
// The note's fret is placed 1 fret from the left of the view; 4 more frets follow.
// Strings: if stringIndex <= 3, show strings [s, s+1, s+2]; if B (4) or high e (5),
// treat as the high note and show 2 lower strings instead.
function computeFretboardZoomForNote(
  stringIndex: number,
  fret: number
): { fretStart: number; fretCount: number; stringStart: number; stringCount: number } {
  const fretStart = Math.max(0, fret - 1);
  const fretCount = 6; // 1 before + note + 4 after
  let stringStart: number;
  if (stringIndex >= 4) {
    // B or high e: zoom to lower strings so the tapped string is on the right
    stringStart = stringIndex - 2;
  } else {
    stringStart = stringIndex;
  }
  stringStart = Math.max(0, Math.min(3, stringStart)); // keep in bounds (0..3 for 3-string view)
  return { fretStart, fretCount, stringStart, stringCount: 3 };
}

// Computes a fretboard layout where the zoom range fills the full display area.
function computeFretboardLayoutZoomed(
  availW: number,
  availH: number,
  noteBarW: number,
  zoom: { fretStart: number; fretCount: number; stringStart: number; stringCount: number }
): FretboardLayout {
  const pad = 8;
  const topPad = 28;

  const GOLDEN = 1.618;
  const fullW = availW - noteBarW - pad * 2;
  const h = availH - topPad - pad;
  const maxW = Math.floor(h / GOLDEN);
  const w = Math.round(Math.min(fullW, maxW));
  const xOff = Math.round((fullW - w) / 2);
  const x = pad + xOff;
  const y = topPad;

  // Map zoomed string range to full width
  const stringGaps = zoom.stringCount - 1 || 1;
  const zoomStringSpacing = w / stringGaps;

  // Map zoomed fret range to full height
  const zoomFretSpacing = h / zoom.fretCount;

  // Compute all 6 string X positions extrapolated from zoom
  const stringXs = Array.from({ length: 6 }, (_, i) =>
    x + (i - zoom.stringStart) * zoomStringSpacing
  );

  // Compute all fret Y positions extrapolated from zoom
  const fretYs = Array.from({ length: FRET_COUNT + 1 }, (_, i) =>
    y + (i - zoom.fretStart) * zoomFretSpacing
  );

  const nutY = fretYs[0]!;
  const dotRadius = Math.min(zoomStringSpacing * 0.38, 18);

  return { x, y, w, h, stringXs, fretYs, nutY, dotRadius };
}

function drawFretboard(
  ctx: CanvasRenderingContext2D,
  layout: FretboardLayout,
  keySemitone: number | null,
  opacity: number,
  showDots: boolean,
  relativeOffset = 0
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

  // Fret position markers — radius scales with fret spacing so they enlarge when zoomed
  const fretSpacing = (fretYs[1]! - fretYs[0]!);
  const inlayR = Math.max(3, fretSpacing * 0.11);
  const markerX = (stringXs[2]! + stringXs[3]!) / 2;
  for (const fret of FRET_MARKERS_SINGLE) {
    const fy = (fretYs[fret - 1]! + fretYs[fret]!) / 2;
    ctx.beginPath();
    ctx.arc(markerX, fy, inlayR, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(180, 190, 220, 0.25)";
    ctx.fill();
  }
  // 12th fret double dot
  {
    const fy = (fretYs[11]! + fretYs[12]!) / 2;
    for (const sx of [stringXs[1]!, stringXs[4]!]) {
      ctx.beginPath();
      ctx.arc(sx, fy, inlayR, 0, Math.PI * 2);
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
        const effDeg = ((ch.degreeIndex - relativeOffset + 7) % 7) as DegreeIndex;
        const colors = degreeColors(effDeg);
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
      const effDotDeg = ((dot.degreeIndex - relativeOffset + 7) % 7) as DegreeIndex;
      const colors = degreeColors(effDotDeg);
      const leading = isLeadingTone(effDotDeg);

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
  update(keySemitone: number | null, relativeOffset?: number): void;
  destroy(): void;
};

const CHROMATIC_NOTES_DISPLAY = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
// Maps display index → semitone
const DISPLAY_TO_SEMITONE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function buildNoteBar(
  hostEl: HTMLElement,
  onPressStart: (semitone: number) => void,
  onPressEnd: (semitone: number) => void,
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
    // Sound starts on pointer-down (instrument, not UI button): note rings while held.
    let activePointerId: number | null = null;
    btn.addEventListener("pointerdown", (evt) => {
      if (activePointerId !== null) return;
      activePointerId = evt.pointerId;
      onPressStart(semitone);
    });
    const endPress = (evt: PointerEvent): void => {
      if (activePointerId === null || evt.pointerId !== activePointerId) return;
      activePointerId = null;
      onPressEnd(semitone);
    };
    btn.addEventListener("pointerup", endPress);
    btn.addEventListener("pointercancel", endPress);
    btn.addEventListener("pointerleave", endPress);
    btns.push(btn);
    el.appendChild(btn);
  }

  hostEl.appendChild(el);

  function update(keySemitone: number | null, relativeOffset = 0): void {
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
      } else {
        // Remap degree by relative root offset so the note bar mirrors the
        // flower colours shown in key-zoom (mustard = root, etc.)
        const effDeg = ((ch.degreeIndex - relativeOffset + 7) % 7) as DegreeIndex;
        if (isLeadingTone(effDeg)) {
          const colors = noteBarColor(effDeg);
          btn.className = "jf-note-btn jf-note-btn--leading";
          btn.style.backgroundColor = colors.bg;
          btn.style.borderColor = colors.border ?? "transparent";
          btn.style.color = colors.text;
        } else {
          const colors = noteBarColor(effDeg);
          btn.className = "jf-note-btn jf-note-btn--diatonic";
          btn.style.backgroundColor = colors.bg;
          btn.style.borderColor = "transparent";
          btn.style.color = colors.text;
        }
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
  /**
   * Double-tapped a circle flower → entered key zoom with this key.
   * (Single tap plays the chord but does not enter key zoom.)
   */
  onKeySelect?: (semitone: number) => void;
  /**
   * User pressed down on a circle flower → start sustain for the chord.
   * isMinor=true when the inner third of the flower was pressed.
   */
  onKeyPressStart?: (semitone: number, isMinor: boolean) => void;
  /** User released from a circle flower → stop sustain. */
  onKeyPressEnd?: () => void;
  /** Double-tapped the center area in circle mode → cycle instrument. */
  onInnerDoubleTap?: () => void;
  /** Pressed down on a chord flower in key-zoom → start sustain for that chord. */
  onChordTap?: (chord: DiatonicChord) => void;
  /** Released from a key-zoom chord flower → stop sustain. */
  onChordPressEnd?: () => void;
  /** Pressed down on a note bar button → start sustain. */
  onNoteBarPressStart?: (semitone: number) => void;
  /** Released a note bar button → stop sustain. */
  onNoteBarPressEnd?: (semitone: number) => void;
  /** Pressed down on a fretboard dot → start sustain. */
  onFretDotTap?: (midi: number, stringIndex: number) => void;
  /** Released from a fretboard dot → stop sustain. */
  onFretDotPressEnd?: () => void;
  /**
   * Returns true if any looper is currently armed/recording.
   * When true, tapping the background in key-zoom will not navigate back to circle.
   */
  isRecording?: () => boolean;
  /**
   * Called whenever the visible mode changes (after a transition completes
   * or immediately on the initial render). Use this to show/hide looper UIs
   * that are relevant to the currently visible instrument.
   */
  onModeChange?: (mode: "circle" | "key-zoom" | "fretboard") => void;
  /**
   * Returns the duration of one measure in milliseconds (used to set the speed
   * of the recent-history note trail, which scrolls across in 2 measures).
   */
  getMeasureDurationMs?: () => number;
};

export type JamFlowUi = {
  enter(): void;
  exit(): void;
  /** Visual pulse on the currently visible display (circle or key zoom) */
  pulseNote(midi: number, durationMs: number): void;
  pulseChord(midis: number[], durationMs: number): void;
  /** Visual pulse on fretboard dots */
  pulseTargets(targets: Array<{ midi: number; stringIndex: number }>, durationMs: number): void;
  /** Update the instrument label shown in the centre of the circle. */
  setInstrumentLabel(label: string): void;
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

  // Instrument label displayed in center of circle mode
  let instrumentLabel = "ACOUSTIC GUITAR";

  // Currently held circle flower (for sustain + minor label display)
  let heldCircleKey: { semitone: number; isMinor: boolean } | null = null;
  // Held key-zoom chord flower or roman-numeral label
  let heldKeyZoomChord: DiatonicChord | null = null;
  // Held fretboard dot
  let heldFretDot: { midi: number; stringIndex: number } | null = null;

  // Live sustain trail: grows from right edge of the note strip while any note is held.
  // Set on pointerdown for circle flowers, key-zoom chords, note bar, and fret dots.
  let liveSustainTrail: { semitone: number; color: string; startT: number } | null = null;

  // Double-tap tracking for circle flowers
  let lastCircleTapInfo: { semitone: number; atMs: number } | null = null;

  // Double-tap tracking for center area in circle mode (instrument change)
  let lastCenterTapTime = 0;

  // Pulse state: a list of active pulse rings
  type Pulse = { x: number; y: number; r: number; startT: number; durationMs: number; color: string };
  const pulses: Pulse[] = [];

  // Dot pulse state (fretboard)
  type DotPulse = { stringIndex: number; fret: number; startT: number; durationMs: number };
  const dotPulses: DotPulse[] = [];

  // Note bar trail state: rectangles that grow leftward from the note bar
  type NoteTrail = { semitone: number; color: string; startT: number; durationMs: number };
  const noteTrails: NoteTrail[] = [];
  // Slow "recent history" trails: slide immediately at constant speed (no growth phase)
  const slowTrails: NoteTrail[] = [];

  // Relative-mode state: which degree index is currently the "root" in key-zoom
  let relativeRootDeg: number | null = null;

  // Double-tap tracking for key-zoom chord flowers
  let lastTapDeg: number | null = null;
  let lastTapTime = 0;

  // Fretboard double-tap zoom state
  type FretboardZoom = { fretStart: number; fretCount: number; stringStart: number; stringCount: number };
  let fretboardZoom: FretboardZoom | null = null;
  let lastFretDotTap = { stringIndex: -1, fret: -1, atMs: 0 };

  // Mode-name tessellated animation (triggered by double-tap)
  type ModeAnim = { startT: number; modeName: string };
  let modeAnim: ModeAnim | null = null;

  // Note bar — sound starts on pointerdown, ends on pointerup/cancel/leave.
  const noteBar = buildNoteBar(
    noteBarHost,
    (semitone) => {
      // Grow a live trail while the note is held.
      liveSustainTrail = { semitone, color: getNoteTrailColor(semitone), startT: performance.now() };
      options.onNoteBarPressStart?.(semitone);
      if (transitionActive) return;
      if (currentMode === "key-zoom") {
        startTransition("key-zoom", "fretboard", true);
      } else if (currentMode === "fretboard") {
        startTransition("fretboard", "key-zoom", false);
      }
    },
    (semitone) => {
      // Freeze trail width and let it slide off.
      if (liveSustainTrail !== null && liveSustainTrail.semitone === semitone) {
        const holdDuration = performance.now() - liveSustainTrail.startT;
        const { color, startT: pressStartT } = liveSustainTrail;
        // Slow trail: startT = now so elapsed=0 → right edge stays at w (no pop).
        slowTrails.push({ semitone, color, startT: performance.now(), durationMs: holdDuration });
        // Fast trail: startT = press-start so elapsed=durationMs → already full-width, slides off.
        noteTrails.push({ semitone, color, startT: pressStartT, durationMs: holdDuration });
        liveSustainTrail = null;
      }
      options.onNoteBarPressEnd?.(semitone);
    },
  );

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

  // ── Note trail helpers ─────────────────────────────────────────────────────

  function getNoteTrailColor(semitone: number): string {
    if (selectedKey === null) return COLOR_WHITE;
    const chords = getDiatonicChords(selectedKey);
    const ch = chords.find((c) => c.semitone === semitone);
    if (!ch) return "rgba(180,185,210,0.5)"; // non-diatonic: muted
    const effDeg = ((ch.degreeIndex - (relativeRootDeg ?? 0) + 7) % 7) as DegreeIndex;
    return degreeColors(effDeg).colorA;
  }

  function addNoteTrail(semitone: number, durationMs: number) {
    const color = getNoteTrailColor(semitone);
    const startT = performance.now();
    noteTrails.push({ semitone, color, startT, durationMs });
    slowTrails.push({ semitone, color, startT, durationMs });
  }

  // ── Tap detection ──────────────────────────────────────────────────────────

  function handleCanvasPointerDown(evt: PointerEvent) {
    if (transitionActive) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (evt.clientX - rect.left);
    const my = (evt.clientY - rect.top);
    const { w, h } = resizeCanvas();
    rebuildLayouts(w, h);

    if (currentMode === "circle") {
      // Check for center double-tap (instrument change).
      // Center zone radius ≈ 15% of the smaller dimension.
      const centerR = Math.min(w, h) * 0.15;
      const dcx = mx - w / 2;
      const dcy = my - h / 2;
      if (dcx * dcx + dcy * dcy <= centerR * centerR) {
        const tapNow = performance.now();
        if (tapNow - lastCenterTapTime < 450) {
          options.onInnerDoubleTap?.();
          lastCenterTapTime = 0;
        } else {
          lastCenterTapTime = tapNow;
        }
        return;
      }

      // Find which flower was pressed
      for (let i = 0; i < 12; i++) {
        const pos = circlePositions[i]!;
        const dx = mx - pos.x;
        const dy = my - pos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq <= pos.r * pos.r) {
          const semitone = CIRCLE_ORDER[i]!;
          // Inner half of flower (canvas-center-facing side) → minor chord.
          // The dividing line is perpendicular to the radial direction and passes
          // through the flower center. Dot product of tap displacement with the
          // outward radial vector < 0 means the tap is on the inward-facing side.
          const outX = pos.x - w / 2;
          const outY = pos.y - h / 2;
          const isMinor = (dx * outX + dy * outY) < 0;

          // Update held state for visual minor-label feedback
          heldCircleKey = { semitone, isMinor };

          // Start live sustain trail anchored at right edge.
          liveSustainTrail = { semitone, color: getNoteTrailColor(semitone), startT: performance.now() };

          // Pulse ring on the flower.
          const chForPulse = selectedKey !== null
            ? getDiatonicChords(selectedKey).find((c) => c.semitone === semitone)
            : null;
          addPulseAtCanvas(pos.x, pos.y, pos.r, chForPulse?.colorA ?? COLOR_WHITE, 400);

          // Start sustain
          options.onKeyPressStart?.(semitone, isMinor);

          // Double-tap detection → enter key zoom
          // (same semitone within 450 ms; inner/outer zone does not need to match)
          const tapNow = performance.now();
          const isDoubleTap =
            lastCircleTapInfo !== null &&
            lastCircleTapInfo.semitone === semitone &&
            tapNow - lastCircleTapInfo.atMs < 450;
          lastCircleTapInfo = { semitone, atMs: tapNow };

          if (isDoubleTap) {
            if (isMinor) {
              // Minor double-tap: enter key zoom showing the relative major,
              // but mark the minor chord (vi of the relative major) as root.
              const majorSemitone = (semitone + 3) % 12;
              selectedKey = majorSemitone;
              relativeRootDeg = 5; // vi is degree index 5
              noteBar.update(majorSemitone, 5);
            } else {
              selectedKey = semitone;
              relativeRootDeg = null;
              noteBar.update(semitone);
            }
            options.onKeySelect?.(semitone);
            startTransition("circle", "key-zoom", true);
          }
          return;
        }
      }
      return;
    } else if (currentMode === "key-zoom" && selectedKey !== null) {
      const chords = getDiatonicChords(selectedKey);

      // Check if the roman numeral label was tapped (bottom-left of each flower).
      // The label is drawn at (pos.x - pos.r, pos.y + pos.r + 3) with font ~0.48*pos.r.
      // Use a generous hit rect so it's easy to target without overlapping the flower.
      for (let deg = 0; deg < 7; deg++) {
        const pos = keyZoomPositions[deg]!;
        const labelSize = Math.max(9, Math.round(pos.r * 0.48));
        const labelX = pos.x - pos.r;
        const labelY = pos.y + pos.r + 1;
        const hitW = pos.r * 1.2;  // wide enough for "vii°"
        const hitH = labelSize * 2.2;
        if (mx >= labelX && mx <= labelX + hitW && my >= labelY && my <= labelY + hitH) {
          const tapNow = performance.now();
          if (lastTapDeg === deg && tapNow - lastTapTime < 450) {
            // Double-tap on roman numeral: toggle relative root
            if (relativeRootDeg === deg) {
              relativeRootDeg = null;
            } else {
              relativeRootDeg = deg;
              modeAnim = { startT: tapNow, modeName: MODE_NAMES[deg]! };
            }
            lastTapDeg = null;
            noteBar.update(selectedKey, relativeRootDeg ?? 0);
          } else {
            // Single tap on roman numeral: start chord sustain + track for double-tap.
            lastTapDeg = deg;
            lastTapTime = tapNow;
            const chord = chords[deg]!;
            heldKeyZoomChord = chord;
            liveSustainTrail = { semitone: chord.semitone, color: chord.colorA, startT: tapNow };
            addPulseAtCanvas(pos.x, pos.y, pos.r, chord.colorA, 400);
            options.onChordTap?.(chord);
          }
          return;
        }
      }

      // Check if a flower body was tapped — start chord sustain.
      for (let deg = 0; deg < 7; deg++) {
        const pos = keyZoomPositions[deg]!;
        const dx = mx - pos.x;
        const dy = my - pos.y;
        if (dx * dx + dy * dy <= pos.r * pos.r) {
          const chord = chords[deg]!;
          heldKeyZoomChord = chord;
          liveSustainTrail = { semitone: chord.semitone, color: chord.colorA, startT: performance.now() };
          addPulseAtCanvas(pos.x, pos.y, pos.r, chord.colorA, 400);
          options.onChordTap?.(chord);
          return;
        }
      }
      // Tap background → clear relative mode or go back to circle
      if (relativeRootDeg !== null) {
        relativeRootDeg = null;
        noteBar.update(selectedKey, 0);
        return;
      }
      // Don't navigate back while a looper is armed or recording
      if (!options.isRecording?.()) {
        startTransition("key-zoom", "circle", false);
      }
    } else if (currentMode === "fretboard" && selectedKey !== null) {
      // Use zoom layout if active, otherwise base layout
      const activeLayout = fretboardZoom
        ? computeFretboardLayoutZoomed(w, h, 0, fretboardZoom)
        : fretboardLayout;
      if (!activeLayout) return;
      // Tap a dot
      const dots = getFretboardDots(selectedKey);
      let hitDot = false;
      for (const dot of dots) {
        const sx = activeLayout.stringXs[dot.stringIndex]!;
        const fy = dot.fret === 0
          ? activeLayout.nutY - activeLayout.dotRadius * 1.1
          : (activeLayout.fretYs[dot.fret - 1]! + activeLayout.fretYs[dot.fret]!) / 2;
        const r = activeLayout.dotRadius * (dot.fret === 0 ? 0.7 : 1);
        const dx = mx - sx;
        const dy = my - fy;
        if (dx * dx + dy * dy <= r * r * 1.4) {
          const tapNow = performance.now();
          const isDoubleTap =
            lastFretDotTap.stringIndex === dot.stringIndex &&
            lastFretDotTap.fret === dot.fret &&
            tapNow - lastFretDotTap.atMs < 400;
          lastFretDotTap = { stringIndex: dot.stringIndex, fret: dot.fret, atMs: tapNow };

          if (isDoubleTap && fretboardZoom === null) {
            // Zoom to octave range centered on this note (only when not already zoomed)
            fretboardZoom = computeFretboardZoomForNote(dot.stringIndex, dot.fret);
          } else {
            heldFretDot = { midi: dot.midi, stringIndex: dot.stringIndex };
            liveSustainTrail = { semitone: dot.midi % 12, color: getNoteTrailColor(dot.midi % 12), startT: performance.now() };
            options.onFretDotTap?.(dot.midi, dot.stringIndex);
            addDotPulse(dot.stringIndex, dot.fret);
          }
          hitDot = true;
          return;
        }
      }
      // Tapping background clears zoom
      if (!hitDot && fretboardZoom) {
        fretboardZoom = null;
      }
    }
  }

  function handleCanvasPointerUp(_evt: PointerEvent) {
    // Finalize the live sustain trail for whichever mode was held.
    if (liveSustainTrail !== null) {
      const holdDuration = performance.now() - liveSustainTrail.startT;
      const { semitone, color, startT: pressStartT } = liveSustainTrail;
      // Slow trail: startT = now so elapsed=0 → right edge stays at w (no pop).
      slowTrails.push({ semitone, color, startT: performance.now(), durationMs: holdDuration });
      // Fast trail: startT = press-start so elapsed=durationMs → already full-width, slides off.
      noteTrails.push({ semitone, color, startT: pressStartT, durationMs: holdDuration });
      liveSustainTrail = null;
    }
    if (heldCircleKey !== null) {
      heldCircleKey = null;
      options.onKeyPressEnd?.();
    }
    if (heldKeyZoomChord !== null) {
      heldKeyZoomChord = null;
      options.onChordPressEnd?.();
    }
    if (heldFretDot !== null) {
      heldFretDot = null;
      options.onFretDotPressEnd?.();
    }
  }

  canvas.addEventListener("pointerdown", handleCanvasPointerDown);
  canvas.addEventListener("pointerup", handleCanvasPointerUp);
  canvas.addEventListener("pointercancel", handleCanvasPointerUp);

  // ── Transitions ────────────────────────────────────────────────────────────

  function startTransition(from: JamFlowMode, to: JamFlowMode, forward: boolean) {
    if (transitionActive) return;
    // Clear relative mode when leaving key-zoom entirely
    if (from === "key-zoom" && to === "circle") {
      relativeRootDeg = null;
      lastTapDeg = null;
      noteBar.update(null);
    }
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
    options.onModeChange?.(currentMode);
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

    // Trails render first so flowers appear on top of them
    drawTrails(now, w, h);

    if (!transitionActive) {
      drawStaticMode(currentMode, w, h);
    } else {
      drawTransition(transitionFrom, transitionTo, transitionForward, easedT, w, h);
      if (rawT >= 1) finishTransition();
    }

    // Pulse rings render on top of everything
    drawPulses(now);

    ctx.restore();
    rafId = requestAnimationFrame(drawFrame);
  }

  // Draws a scrolling tessellated overlay of the current mode name.
  // Fades in, holds, then fades out over ~2.4 s. Rendered behind the flowers.
  function drawModeAnim(now: number, w: number, h: number) {
    if (!modeAnim) return;
    const elapsed = now - modeAnim.startT;
    const totalDur = 2400;
    if (elapsed > totalDur) { modeAnim = null; return; }

    const fadeInMs = 400, fadeOutMs = 400;
    let alpha: number;
    if (elapsed < fadeInMs) alpha = elapsed / fadeInMs;
    else if (elapsed < totalDur - fadeOutMs) alpha = 1;
    else alpha = 1 - (elapsed - (totalDur - fadeOutMs)) / fadeOutMs;

    // Scroll left at 55 px/s
    const scrollX = (elapsed / 1000) * 55;

    ctx.save();
    ctx.globalAlpha = alpha * 0.14;
    ctx.fillStyle = COLOR_WHITE;
    const fontSize = Math.max(11, Math.min(26, h * 0.07));
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const text = modeAnim.modeName.toUpperCase();
    const unitW = ctx.measureText(text).width + fontSize * 1.8;
    const rowH  = fontSize * 2.6;
    const rows  = Math.ceil(h / rowH) + 2;

    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    for (let row = 0; row < rows; row++) {
      const y = (row - 0.5) * rowH;
      // Stagger odd rows by half a unit to create tessellation
      const stagger = row % 2 === 0 ? 0 : unitW / 2;
      const baseX = -((scrollX + stagger) % unitW);
      for (let x = baseX; x < w + unitW; x += unitW) {
        ctx.fillText(text, x, y);
      }
    }
    ctx.restore();
  }

  function drawStaticMode(mode: JamFlowMode, w: number, h: number) {
    if (mode === "circle") {
      drawCircleMode(w, h, 1);
    } else if (mode === "key-zoom") {
      if (selectedKey !== null) {
        const relOff = relativeRootDeg ?? 0;
        drawFretboard(ctx, fretboardLayout!, selectedKey, 0.2, false, relOff);
        drawModeAnim(performance.now(), w, h);
        drawKeyZoomMode(w, h, 1);
      }
    } else if (mode === "fretboard") {
      if (fretboardLayout) {
        const activeLayout = fretboardZoom
          ? computeFretboardLayoutZoomed(w, h, 0, fretboardZoom)
          : fretboardLayout;
        drawFretboard(ctx, activeLayout, selectedKey, 1, true, relativeRootDeg ?? 0);
      }
    }
  }

  function drawCircleMode(w: number, h: number, opacity: number) {
    const cx = w / 2;
    const cy = h / 2;

    // Center instrument label (rotated text)
    ctx.save();
    ctx.globalAlpha = opacity * 0.18;
    ctx.fillStyle = COLOR_WHITE;
    const fontSize = Math.max(8, Math.min(12, w * 0.028));
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(instrumentLabel, 0, 0);
    ctx.restore();

    for (let i = 0; i < 12; i++) {
      const pos = circlePositions[i]!;
      const semitone = CIRCLE_ORDER[i]!;
      // Show minor label (e.g. "Cm") while that flower is held in the inner third
      const isHeldMinor = heldCircleKey?.semitone === semitone && heldCircleKey.isMinor;
      const label = isHeldMinor
        ? (NOTE_NAMES_FLAT[semitone]! + "m")
        : NOTE_NAMES_FLAT[semitone]!;
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

      // If a relative root is active, remap colours/roman/petalCount
      let colorA = chord.colorA;
      let colorB = chord.colorB;
      let roman  = chord.roman;
      let petalCount = chord.petalCount;
      if (relativeRootDeg !== null) {
        const effDeg = ((deg - relativeRootDeg + 7) % 7) as DegreeIndex;
        const ec = degreeColors(effDeg);
        colorA     = ec.colorA;
        colorB     = ec.colorB;
        // Roman numeral reflects the chord's actual quality at this modal position
        roman      = relativeRoman(effDeg, chord.quality);
        petalCount = DEGREE_PETAL_COUNTS[effDeg]!;
      }

      // No labels inside the flower — chord name is too small to read clearly.
      drawKiku(ctx, pos.x, pos.y, pos.r, petalCount, colorA, colorB, undefined, undefined, opacity);

      // Roman numeral at bottom-left of flower on the dark background.
      if (opacity > 0) {
        const romanSize = Math.max(9, Math.round(pos.r * 0.48));
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.fillStyle = "#f0ece0";
        ctx.font = `900 ${romanSize}px system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(roman, pos.x - pos.r, pos.y + pos.r + 3);
        ctx.restore();
      }
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

      const petalCount = t < 0.3 ? 14 : chord.petalCount;
      const showRoman = t > 0.5;

      drawKiku(ctx, x, y, r, petalCount, colorA, colorB, undefined, undefined, 1);

      // Roman numeral appears at bottom-left of the flower from t=0.5
      if (showRoman) {
        const romanAlpha = Math.min(1, (t - 0.5) / 0.3);
        const romanSize = Math.max(9, Math.round(r * 0.48));
        ctx.save();
        ctx.globalAlpha = romanAlpha;
        ctx.fillStyle = "#f0ece0";
        ctx.font = `900 ${romanSize}px system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(chord.roman, x - r, y + r + 3);
        ctx.restore();
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
    const relOff = relativeRootDeg ?? 0;
    drawFretboard(ctx, fretboardLayout, selectedKey, fretOpacity, t > 0.5, relOff);

    // Kiku flowers fade out (no labels — key zoom never shows notes inside flowers)
    const flowerOpacity = 1 - t;
    if (flowerOpacity > 0) {
      const drawOrder: DegreeIndex[] = [6, 1, 2, 5, 3, 4, 0];
      for (const deg of drawOrder) {
        const chord = chords[deg]!;
        const pos = keyZoomPositions[deg]!;
        drawKiku(ctx, pos.x, pos.y, pos.r, chord.petalCount,
          chord.colorA, chord.colorB, undefined, undefined, flowerOpacity);
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

  // Fast trails: grow from right edge over the note's duration, then slide off.
  function drawFastTrailSet(
    trails: NoteTrail[],
    now: number,
    w: number,
    h: number,
    speed: number,
    maxAlpha: number,
    trailHeightFraction: number
  ): void {
    const noteH = h / 12;
    const trailH = noteH * trailHeightFraction;
    const alive: NoteTrail[] = [];

    for (const trail of trails) {
      const elapsed = now - trail.startT;
      const maxW = Math.min(w, trail.durationMs * speed);
      // Keep alive until right edge exits left side (elapsed >= durationMs + w/speed)
      const exitDuration = w / speed;
      if (elapsed >= trail.durationMs + exitDuration) continue;
      alive.push(trail);

      const y = 4 + (trail.semitone + 0.5) * (h - 8) / 12;

      let drawLeft: number, drawRight: number, alpha: number;
      if (elapsed < trail.durationMs) {
        const currentW = Math.min(maxW, elapsed * speed);
        drawRight = w;
        drawLeft = w - currentW;
        alpha = maxAlpha;
      } else {
        const slide = (elapsed - trail.durationMs) * speed;
        drawRight = w - slide;
        drawLeft = w - maxW - slide;
        if (drawRight <= 0) continue;
        // Fade as it exits
        alpha = maxAlpha * Math.max(0, 1 - (elapsed - trail.durationMs) / exitDuration);
      }

      const visLeft  = Math.max(0, drawLeft);
      const visRight = Math.min(w, drawRight);
      if (visRight <= visLeft) continue;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = trail.color;
      ctx.fillRect(visLeft, y - trailH / 2, visRight - visLeft, trailH);
      ctx.restore();
    }

    trails.length = 0;
    trails.push(...alive);
  }

  // Slow "recent history" trails: start at right edge and slide left at constant speed.
  // No growth phase — the bar moves at speed from the moment the note plays.
  // Total visible time = w / speed = 2 * measureDurationMs exactly.
  function drawSlowTrailSet(
    trails: NoteTrail[],
    now: number,
    w: number,
    h: number,
    speed: number,
    maxAlpha: number,
    trailHeightFraction: number
  ): void {
    const noteH = h / 12;
    const trailH = noteH * trailHeightFraction;
    const alive: NoteTrail[] = [];

    for (const trail of trails) {
      const elapsed = now - trail.startT;
      // Bar width is proportional to note duration
      const barW = Math.min(w, trail.durationMs * speed);
      const slide = elapsed * speed;
      const drawRight = w - slide;

      if (drawRight <= 0) continue; // right edge has exited
      alive.push(trail);

      const drawLeft = drawRight - barW;
      const visLeft  = Math.max(0, drawLeft);
      const visRight = Math.min(w, drawRight);
      if (visRight <= visLeft) continue;

      const y = 4 + (trail.semitone + 0.5) * (h - 8) / 12;
      ctx.save();
      ctx.globalAlpha = maxAlpha;
      ctx.fillStyle = trail.color;
      ctx.fillRect(visLeft, y - trailH / 2, visRight - visLeft, trailH);
      ctx.restore();
    }

    trails.length = 0;
    trails.push(...alive);
  }

  function drawTrails(now: number, w: number, h: number) {
    // Fast trail: grows from right edge over the note duration, then slides off.
    const FAST_SPEED = w / 550;

    // Slow "recent history" trail: traverses full canvas in exactly 2 measures.
    const measureDurationMs = options.getMeasureDurationMs?.() ?? 2000;
    const SLOW_SPEED = w / (2 * measureDurationMs);

    // Draw slow trail first (below fast trail) — no fade, full alpha
    drawSlowTrailSet(slowTrails, now, w, h, SLOW_SPEED, 0.62, 0.54);

    // Render live sustain trail: grows leftward from right edge while key is held
    if (liveSustainTrail !== null) {
      const elapsed = now - liveSustainTrail.startT;
      const barW = Math.min(w, elapsed * SLOW_SPEED);
      if (barW > 0) {
        const noteH = h / 12;
        const trailH = noteH * 0.54;
        const y = 4 + (liveSustainTrail.semitone + 0.5) * (h - 8) / 12;
        ctx.save();
        ctx.globalAlpha = 0.62;
        ctx.fillStyle = liveSustainTrail.color;
        ctx.fillRect(w - barW, y - trailH / 2, barW, trailH);
        ctx.restore();
      }
    }

    // Draw fast trail on top, more transparent — fades as it exits
    drawFastTrailSet(noteTrails, now, w, h, FAST_SPEED, 0.32, 0.46);
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
    options.onModeChange?.(currentMode);
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

  function pulseFlower(midi: number, durationMs: number) {
    // Add a pulse ring at the flower position for this midi note.
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

  function pulseNote(midi: number, durationMs: number) {
    pulseFlower(midi, durationMs);
    addNoteTrail(midi % 12, durationMs);
  }

  function pulseChord(midis: number[], durationMs: number) {
    // Only pulse the root flower (first midi); trails emit for every note.
    if (midis[0] !== undefined) pulseFlower(midis[0], durationMs);
    for (const midi of midis) addNoteTrail(midi % 12, durationMs);
  }

  function pulseTargets(targets: Array<{ midi: number; stringIndex: number }>, durationMs: number) {
    // Add note trails for all targets
    for (const t of targets) {
      addNoteTrail(t.midi % 12, durationMs);
    }

    if (!fretboardLayout) return;
    const activeLayout = fretboardZoom
      ? computeFretboardLayoutZoomed(cachedW, cachedH, 0, fretboardZoom)
      : fretboardLayout;

    for (const t of targets) {
      const semitone = t.midi % 12;
      const sx = activeLayout.stringXs[t.stringIndex];
      if (sx !== undefined && selectedKey !== null) {
        const dots = getFretboardDots(selectedKey);
        const match = dots.find((d) => d.stringIndex === t.stringIndex && d.semitone === semitone);
        if (match) {
          const fy = match.fret === 0
            ? activeLayout.nutY - activeLayout.dotRadius * 1.1
            : (activeLayout.fretYs[match.fret - 1]! + activeLayout.fretYs[match.fret]!) / 2;
          const r = activeLayout.dotRadius;
          addPulseAtCanvas(sx, fy, r, COLOR_WHITE, durationMs);
        }
      }
    }
  }

  function setInstrumentLabel(label: string): void {
    instrumentLabel = label;
  }

  function destroy() {
    exit();
    canvas.removeEventListener("pointerdown", handleCanvasPointerDown);
    canvas.removeEventListener("pointerup", handleCanvasPointerUp);
    canvas.removeEventListener("pointercancel", handleCanvasPointerUp);
    noteBar.destroy();
    wrapper.remove();
  }

  return { enter, exit, pulseNote, pulseChord, pulseTargets, setInstrumentLabel, destroy };
}
