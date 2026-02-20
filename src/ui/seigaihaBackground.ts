import type { ModeId } from "../modes/types.js";

type BackgroundMode = ModeId;

type SeigaihaOpts = {
  tileSize?: number;
  radius?: number;
  noiseLevel?: number;
};

type TileGeometry = {
  tileSize: number;
  radius: number;
  dx: number;
  dy: number;
};

// Tile must be a multiple of both dx=(2R) and the stagger period (2dy=2R)
// so the pattern repeats without seams.
const DEFAULT_RADIUS = 48;
const DEFAULT_TILE_SIZE = 288;
const TILE_PADDING_CELLS = 2;
const NOISE_QUANTUM = 0.02;
const DRIFT_CYCLE_MS = 16000;
const DEBUG = false;

let targetEl: HTMLElement | null = null;
let activeMode: BackgroundMode = "tuner";
let beatIntervalMs = 500;
let lastBeatAt = performance.now();
let tunerStability = 0;

let targetNoiseLevel = 0.25;
let currentNoiseLevel = 0.25;
let rafId: number | null = null;
let lastDebugLogAt = 0;

let seigaihaSmallImageUrl = "";
let seigaihaMediumImageUrl = "";
let seigaihaLargeImageUrl = "";

let grainImageUrl = "";

let lastApplied = {
  noiseLevel: -1,
  blurPx: -1,
  cardOpacity: -1,
  grainOffsetX: Number.NaN,
  grainOffsetY: Number.NaN,
  patternImage: "",
  cardImage: "",
  grainImage: "",
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function beatEnvelope(now: number): number {
  if (beatIntervalMs <= 0) return 0;
  const elapsed = (now - lastBeatAt) % beatIntervalMs;
  const progress = clamp(elapsed / beatIntervalMs);
  return Math.pow(Math.sin(progress * Math.PI), 0.85);
}

function normalizeTileGeometry(tileSize: number, radius: number): TileGeometry {
  const safeRadius = Math.max(8, Math.round(radius));
  const dx = 2 * safeRadius;
  const dy = safeRadius;
  const period = Math.max(dx, 2 * dy);
  const resolvedTileSize = Math.max(period, Math.round(tileSize / period) * period);

  return {
    tileSize: resolvedTileSize,
    radius: safeRadius,
    dx,
    dy,
  };
}

function buildArcPath(cx: number, cy: number, radius: number): string {
  return `M ${(cx - radius).toFixed(2)} ${cy.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 1 ${(cx + radius).toFixed(2)} ${cy.toFixed(2)}`;
}

function makeSeigaihaArcs(geometry: TileGeometry, noiseLevel: number): string {
  const { tileSize, radius, dx, dy } = geometry;
  const radii = [radius, (radius * 2) / 3, radius / 3];
  const strokeWidths = [2.0, 1.6, 1.2];

  const minY = -TILE_PADDING_CELLS * dy;
  const maxY = tileSize + TILE_PADDING_CELLS * dy;
  const minRow = Math.floor(minY / dy);
  const maxRow = Math.ceil(maxY / dy);

  const arcs: string[] = [];
  const strokeOpacity = lerp(0.08, 0.13, 1 - noiseLevel);

  for (let row = minRow; row <= maxRow; row += 1) {
    const cy = row * dy;
    const parity = ((row % 2) + 2) % 2;
    const xOffset = parity * radius;

    const minX = -TILE_PADDING_CELLS * dx - xOffset;
    const maxX = tileSize + TILE_PADDING_CELLS * dx - xOffset;
    const minCol = Math.floor(minX / dx);
    const maxCol = Math.ceil(maxX / dx);

    for (let col = minCol; col <= maxCol; col += 1) {
      const cx = col * dx + xOffset;
      for (let i = 0; i < radii.length; i += 1) {
        const arcRadius = radii[i] ?? radius;
        const strokeWidth = strokeWidths[i] ?? 1.2;
        arcs.push(
          `<path d="${buildArcPath(cx, cy, arcRadius)}" fill="none" stroke="rgb(236,244,255)" stroke-opacity="${strokeOpacity.toFixed(3)}" stroke-width="${strokeWidth.toFixed(2)}" vector-effect="non-scaling-stroke"/>`
        );
      }
    }
  }

  return arcs.join("");
}

export function makeSeigaihaTileSvg(opts: SeigaihaOpts = {}): string {
  const geometry = normalizeTileGeometry(
    opts.tileSize ?? DEFAULT_TILE_SIZE,
    opts.radius ?? DEFAULT_RADIUS
  );
  const noiseLevel = clamp(opts.noiseLevel ?? 0);
  const inkVarOpacity = lerp(0.0, 0.10, noiseLevel);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.tileSize}" height="${geometry.tileSize}" viewBox="0 0 ${geometry.tileSize} ${geometry.tileSize}">
    ${makeSeigaihaArcs(geometry, noiseLevel)}
    <rect width="100%" height="100%" fill="rgb(232,241,255)" opacity="${inkVarOpacity.toFixed(3)}"/>
  </svg>`;
}

function makeGrainTileSvg(tileSize = 256): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tileSize}" height="${tileSize}" viewBox="0 0 ${tileSize} ${tileSize}">
    <defs>
      <filter id="grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed="7" stitchTiles="stitch" result="grainNoise"/>
        <feColorMatrix in="grainNoise" type="saturate" values="0" result="monoNoise"/>
      </filter>
    </defs>
    <rect width="100%" height="100%" filter="url(#grain)" opacity="0.75"/>
  </svg>`;
}

export function svgToDataUrl(svg: string): string {
  const compact = svg.replace(/\s{2,}/g, " ").replace(/\n/g, "").trim();
  return `data:image/svg+xml,${encodeURIComponent(compact)}`;
}

function quantizeNoiseLevel(noiseLevel: number): number {
  return Math.round(clamp(noiseLevel) / NOISE_QUANTUM) * NOISE_QUANTUM;
}

function cacheSeigaihaTiles(): void {
  if (seigaihaUrlCache.size > 0 && cardUrlCache.size > 0) {
    return;
  }

  for (let i = 0; i <= Math.round(1 / NOISE_QUANTUM); i += 1) {
    const key = (i * NOISE_QUANTUM).toFixed(2);
    const noiseLevel = Number(key);
    const svg = makeSeigaihaTileSvg({
      tileSize: DEFAULT_TILE_SIZE,
      radius: DEFAULT_RADIUS,
      noiseLevel,
    });
    const url = `url("${svgToDataUrl(svg)}")`;
    seigaihaUrlCache.set(key, url);
    cardUrlCache.set(key, url);
  }
}

function getSeigaihaUrlForNoiseLevel(noiseLevel: number): string {
  const key = quantizeNoiseLevel(noiseLevel).toFixed(2);
  return seigaihaUrlCache.get(key) ?? seigaihaUrlCache.get("0.00") ?? "none";
}

function getCardSeigaihaUrlForNoiseLevel(noiseLevel: number): string {
  const key = quantizeNoiseLevel(noiseLevel).toFixed(2);
  return cardUrlCache.get(key) ?? cardUrlCache.get("0.00") ?? "none";
}

function getGrainImageUrl(): string {
  if (!grainImageUrl) {
    grainImageUrl = `url("${svgToDataUrl(makeGrainTileSvg())}")`;
  }
  return grainImageUrl;
}

function applyVars(el: HTMLElement, noiseLevel: number, now: number): void {
  const quantized = quantizeNoiseLevel(noiseLevel);

  const blurPx = lerp(0.0, 0.8, quantized);
  const cardOpacity = lerp(0.10, 0.05, quantized);
  const seigaihaOpacity = lerp(0.24, 0.14, quantized);
  const grainOpacity = lerp(0.0, 0.14, quantized);

  const patternImage = getSeigaihaUrlForNoiseLevel(quantized);
  const cardImage = getCardSeigaihaUrlForNoiseLevel(quantized);
  const grainImage = getGrainImageUrl();

  const driftPhase = now / DRIFT_CYCLE_MS;
  const driftScale = lerp(0.1, 1, quantized);
  const grainOffsetX = Number((Math.sin(driftPhase * Math.PI * 2) * 18 * driftScale).toFixed(2));
  const grainOffsetY = Number((Math.cos(driftPhase * Math.PI * 1.6) * 14 * driftScale).toFixed(2));

  if (patternImage !== lastApplied.patternImage) {
    el.style.setProperty("--seigaiha-image", patternImage);
    lastApplied.patternImage = patternImage;
  }

function applyStaticVars(el: HTMLElement): void {
  initializeSeigaihaImages();

  if (grainImage !== lastApplied.grainImage) {
    el.style.setProperty("--grain-image", grainImage);
    lastApplied.grainImage = grainImage;
  }

  if (Math.abs(quantized - lastApplied.noiseLevel) > 0.001) {
    el.style.setProperty("--bg-noise", quantized.toFixed(3));
    el.style.setProperty("--seigaiha-opacity", seigaihaOpacity.toFixed(3));
    el.style.setProperty("--seigaiha-grain-opacity", grainOpacity.toFixed(3));
    lastApplied.noiseLevel = quantized;
  }
  if (seigaihaMediumImageUrl !== lastApplied.mediumImage) {
    el.style.setProperty("--seigaiha-medium-image", seigaihaMediumImageUrl);
    lastApplied.mediumImage = seigaihaMediumImageUrl;
  }
  if (seigaihaLargeImageUrl !== lastApplied.largeImage) {
    el.style.setProperty("--seigaiha-large-image", seigaihaLargeImageUrl);
    lastApplied.largeImage = seigaihaLargeImageUrl;
  }

  if (grainOffsetX !== lastApplied.grainOffsetX || grainOffsetY !== lastApplied.grainOffsetY) {
    el.style.setProperty("--grain-offset-x", `${grainOffsetX}px`);
    el.style.setProperty("--grain-offset-y", `${grainOffsetY}px`);
    lastApplied.grainOffsetX = grainOffsetX;
    lastApplied.grainOffsetY = grainOffsetY;
  }

  el.style.setProperty("--seigaiha-size", `${DEFAULT_TILE_SIZE}px ${DEFAULT_TILE_SIZE}px`);

  if (DEBUG && now - lastDebugLogAt >= 1000) {
    lastDebugLogAt = now;
    console.debug("[seigaiha] noiseLevel", quantized.toFixed(3));
  }
}

function computeDriftNoise(now: number): number {
  const t = now / DRIFT_CYCLE_MS;
  const slow = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
  const slower = 0.5 + 0.5 * Math.sin(t * Math.PI * 0.9 + 1.1);
  return (slow * 0.65 + slower * 0.35) * 0.16;
}

function computeTargetNoiseLevel(now: number): number {
  const drift = computeDriftNoise(now);

  if (activeMode === "tuner") {
    return clamp(0.04 + tunerStability * 0.58 + drift);
  }

  if (activeMode === "metronome" || activeMode === "drum-machine") {
    return clamp(0.08 + beatEnvelope(now) * 0.58 + drift);
  }

  return clamp(0.12 + drift);
}

function render(now: number): void {
  if (!targetEl) return;
  const offsets = computeWaveOffsets(now);
  applyWaveVars(targetEl, offsets);

  targetNoiseLevel = computeTargetNoiseLevel(now);
  currentNoiseLevel = lerp(currentNoiseLevel, targetNoiseLevel, 0.12);

  applyVars(targetEl, currentNoiseLevel, now);

  rafId = window.requestAnimationFrame(render);
}

export function applySeigaihaBackground(el: HTMLElement, noiseLevel: number): void {
  currentNoiseLevel = clamp(noiseLevel);
  targetNoiseLevel = currentNoiseLevel;
  applyVars(el, currentNoiseLevel, performance.now());
}

export function initializeSeigaihaBackground(el: HTMLElement): void {
  targetEl = el;
  cacheSeigaihaTiles();

  const configured = Number.parseFloat(
    getComputedStyle(el).getPropertyValue("--bg-noise")
  );
  if (Number.isFinite(configured)) {
    currentNoiseLevel = clamp(configured);
    targetNoiseLevel = currentNoiseLevel;
  }

  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
  }

  lastApplied = {
    noiseLevel: -1,
    blurPx: -1,
    cardOpacity: -1,
    grainOffsetX: Number.NaN,
    grainOffsetY: Number.NaN,
    patternImage: "",
    cardImage: "",
    grainImage: "",
  };

  applyVars(el, currentNoiseLevel, performance.now());
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
