import type { ModeId } from "../modes/types.js";

type BackgroundMode = ModeId;

type SeigaihaOpts = {
  tileSize?: number;
  radius?: number;
  noise?: number;
  includeGrain?: boolean;
};

// Tile must be a multiple of both dx=(2R) and the stagger period (2dy=2R)
// so the pattern repeats without seams.
const DEFAULT_RADIUS = 48;
const DEFAULT_TILE_SIZE = 288;

const NOISE_QUANTUM = 0.02;

let targetEl: HTMLElement | null = null;
let activeMode: BackgroundMode = "tuner";

let beatIntervalMs = 500;
let lastBeatAt = performance.now();
let tunerStability = 0;

let targetNoise = 0.25;
let currentNoise = 0.25;
let rafId: number | null = null;

const seigaihaUrlCache = new Map<string, string>();
const cardUrlCache = new Map<string, string>();

let lastApplied = {
  noise: -1,
  blurPx: -1,
  cardOpacity: -1,
  patternImage: "",
  cardImage: "",
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function beatEnvelope(now: number): number {
  if (beatIntervalMs <= 0) return 0;
  const elapsed = (now - lastBeatAt) % beatIntervalMs;
  const progress = clamp(elapsed / beatIntervalMs);
  return Math.pow(Math.sin(progress * Math.PI), 0.85);
}

function buildArcPath(cx: number, cy: number, radius: number): string {
  return `M ${(cx - radius).toFixed(2)} ${cy.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 1 ${(cx + radius).toFixed(2)} ${cy.toFixed(2)}`;
}

export function makeSeigaihaTileSvg(opts: SeigaihaOpts = {}): string {
  const tileSize = opts.tileSize ?? DEFAULT_TILE_SIZE;
  const baseRadius = opts.radius ?? DEFAULT_RADIUS;
  const noise = clamp(opts.noise ?? 0);
  const includeGrain = opts.includeGrain ?? true;

  const patternOpacity = lerp(0.08, 0.13, 1 - noise);
  const displacementScale = lerp(0, 2.4, noise);
  const inkVarOpacity = lerp(0.0, 0.10, noise);
  const grainOpacity = includeGrain ? lerp(0.0, 0.14, noise) : 0;

  const dx = 2 * baseRadius;
  const dy = baseRadius;

  const radii = [baseRadius, (baseRadius * 2) / 3, baseRadius / 3];
  const strokeWidths = [2.0, 1.6, 1.2];

  const cols = Math.ceil(tileSize / dx) + 2;
  const rows = Math.ceil(tileSize / dy) + 2;

  const arcs: string[] = [];
  for (let row = -1; row < rows; row++) {
    const cy = row * dy;
    const parity = ((row % 2) + 2) % 2;
    const xOffset = parity * baseRadius;

    for (let col = -1; col < cols; col++) {
      const cx = col * dx + xOffset;
      for (let i = 0; i < radii.length; i++) {
        const radius = radii[i] ?? baseRadius;
        const strokeWidth = strokeWidths[i] ?? 1.2;
        arcs.push(
          `<path d="${buildArcPath(cx, cy, radius)}" fill="none" stroke="rgb(236,244,255)" stroke-opacity="${patternOpacity.toFixed(3)}" stroke-width="${strokeWidth.toFixed(2)}" vector-effect="non-scaling-stroke"/>`
        );
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tileSize}" height="${tileSize}" viewBox="0 0 ${tileSize} ${tileSize}">
    <defs>
      <filter id="inkWarp" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="1" seed="13" stitchTiles="stitch" result="inkNoise"/>
        <feDisplacementMap in="SourceGraphic" in2="inkNoise" scale="${displacementScale.toFixed(3)}" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      <filter id="grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed="7" stitchTiles="stitch" result="grainNoise"/>
        <feColorMatrix in="grainNoise" type="saturate" values="0" result="monoNoise"/>
      </filter>
    </defs>

    <g filter="url(#inkWarp)">${arcs.join("")}</g>
    <rect width="100%" height="100%" fill="rgb(232,241,255)" opacity="${inkVarOpacity.toFixed(3)}"/>
    ${includeGrain ? `<rect width="100%" height="100%" filter="url(#grain)" opacity="${grainOpacity.toFixed(3)}"/>` : ""}
  </svg>`;
}

export function svgToDataUrl(svg: string): string {
  const compact = svg.replace(/\s{2,}/g, " ").replace(/\n/g, "").trim();
  return `data:image/svg+xml,${encodeURIComponent(compact)}`;
}

function quantizeNoise(noise: number): number {
  return Math.round(clamp(noise) / NOISE_QUANTUM) * NOISE_QUANTUM;
}

function getSeigaihaUrlForNoise(noise: number): string {
  const key = quantizeNoise(noise).toFixed(2);
  const cached = seigaihaUrlCache.get(key);
  if (cached) return cached;

  const svg = makeSeigaihaTileSvg({
    tileSize: DEFAULT_TILE_SIZE,
    radius: DEFAULT_RADIUS,
    noise: Number(key),
    includeGrain: false,
  });
  const url = `url("${svgToDataUrl(svg)}")`;
  seigaihaUrlCache.set(key, url);
  return url;
}

function getCardSeigaihaUrlForNoise(noise: number): string {
  const key = quantizeNoise(noise).toFixed(2);
  const cached = cardUrlCache.get(key);
  if (cached) return cached;

  const svg = makeSeigaihaTileSvg({
    tileSize: DEFAULT_TILE_SIZE,
    radius: DEFAULT_RADIUS,
    noise: Number(key),
    includeGrain: false,
  });
  const url = `url("${svgToDataUrl(svg)}")`;
  cardUrlCache.set(key, url);
  return url;
}

function applyVars(el: HTMLElement, noise: number): void {
  const quantized = quantizeNoise(noise);

  const blurPx = lerp(0.0, 0.8, quantized);
  const cardOpacity = lerp(0.05, 0.10, 1 - quantized);
  const seigaihaOpacity = lerp(0.14, 0.24, 1 - quantized);
  const grainOpacity = lerp(0.0, 0.14, quantized);

  const patternImage = getSeigaihaUrlForNoise(quantized);
  const cardImage = getCardSeigaihaUrlForNoise(quantized);

  if (patternImage !== lastApplied.patternImage) {
    el.style.setProperty("--seigaiha-image", patternImage);
    lastApplied.patternImage = patternImage;
  }

  if (cardImage !== lastApplied.cardImage) {
    el.style.setProperty("--card-seigaiha-image", cardImage);
    lastApplied.cardImage = cardImage;
  }

  if (Math.abs(quantized - lastApplied.noise) > 0.001) {
    el.style.setProperty("--bg-noise", quantized.toFixed(3));
    el.style.setProperty("--seigaiha-opacity", seigaihaOpacity.toFixed(3));
    el.style.setProperty("--seigaiha-grain-opacity", grainOpacity.toFixed(3));
    lastApplied.noise = quantized;
  }

  if (Math.abs(blurPx - lastApplied.blurPx) > 0.001) {
    el.style.setProperty("--seigaiha-blur", `${blurPx.toFixed(3)}px`);
    lastApplied.blurPx = blurPx;
  }

  if (Math.abs(cardOpacity - lastApplied.cardOpacity) > 0.001) {
    el.style.setProperty("--card-seigaiha-opacity", cardOpacity.toFixed(3));
    lastApplied.cardOpacity = cardOpacity;
  }

  el.style.setProperty("--seigaiha-size", `${DEFAULT_TILE_SIZE}px ${DEFAULT_TILE_SIZE}px`);
}

function computeTargetNoise(now: number): number {
  if (activeMode === "tuner") {
    return clamp(0.18 + tunerStability * 0.55);
  }

  if (activeMode === "metronome" || activeMode === "drum-machine") {
    return clamp(0.14 + beatEnvelope(now) * 0.62);
  }

  return 0.25;
}

function render(now: number): void {
  if (!targetEl) return;

  targetNoise = computeTargetNoise(now);
  currentNoise = lerp(currentNoise, targetNoise, 0.12);

  applyVars(targetEl, currentNoise);

  rafId = window.requestAnimationFrame(render);
}

export function applySeigaihaBackground(el: HTMLElement, noise: number): void {
  currentNoise = clamp(noise);
  targetNoise = currentNoise;
  applyVars(el, currentNoise);
}

export function initializeSeigaihaBackground(el: HTMLElement): void {
  targetEl = el;

  const configured = Number.parseFloat(
    getComputedStyle(el).getPropertyValue("--bg-noise")
  );
  if (Number.isFinite(configured)) {
    currentNoise = clamp(configured);
    targetNoise = currentNoise;
  }

  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
  }

  lastApplied = {
    noise: -1,
    blurPx: -1,
    cardOpacity: -1,
    patternImage: "",
    cardImage: "",
  };

  rafId = window.requestAnimationFrame(render);
}

export function setBackgroundMode(mode: BackgroundMode): void {
  activeMode = mode;
}

export function setTunerBackgroundNoise(
  cents: number | null,
  isDetecting: boolean
): void {
  if (!isDetecting || cents === null) {
    tunerStability = 0;
    return;
  }

  tunerStability = clamp(Math.abs(cents) / 50);
}

export function pulseRhythmBackground(beatMs: number): void {
  beatIntervalMs = Math.max(80, beatMs);
  lastBeatAt = performance.now();
}

export function setRhythmBackgroundIdleNoise(): void {
  lastBeatAt = performance.now() - beatIntervalMs / 2;
}
