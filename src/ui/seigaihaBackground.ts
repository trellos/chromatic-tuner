import type { ModeId } from "../modes/types.js";

type BackgroundMode = ModeId;

type SeigaihaOpts = {
  tileSize: number;
  radius: number;
};

type TileGeometry = {
  tileSize: number;
  radius: number;
  dx: number;
  dy: number;
};

type WaveOffsets = {
  lx: number;
  ly: number;
  mx: number;
  my: number;
  sx: number;
  sy: number;
};

const DEBUG_WAVES = true;
const DEBUG_DURATION_MS = 5000;
const TILE_PADDING_CELLS = 2;

const SMALL_TILE = { radius: 36, tileSize: 288 };
const MEDIUM_TILE = { radius: 48, tileSize: 288 };
const LARGE_TILE = { radius: 60, tileSize: 360 };

let targetEl: HTMLElement | null = null;
let activeMode: BackgroundMode = "tuner";
let beatIntervalMs = 500;
let lastBeatAt = performance.now();
let tunerStability = 0;

let rafId: number | null = null;
let debugStartedAt = 0;
let lastDebugLogAt = 0;

let seigaihaSmallImageUrl = "";
let seigaihaMediumImageUrl = "";
let seigaihaLargeImageUrl = "";

let lastApplied = {
  lx: Number.NaN,
  ly: Number.NaN,
  mx: Number.NaN,
  my: Number.NaN,
  sx: Number.NaN,
  sy: Number.NaN,
  smallImage: "",
  mediumImage: "",
  largeImage: "",
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

function makeSeigaihaArcs(geometry: TileGeometry): string {
  const { tileSize, radius, dx, dy } = geometry;
  const radii = [radius, (radius * 2) / 3, radius / 3];
  const strokeWidths = [radius * 0.041, radius * 0.033, radius * 0.025];

  const minY = -TILE_PADDING_CELLS * dy;
  const maxY = tileSize + TILE_PADDING_CELLS * dy;
  const minRow = Math.floor(minY / dy);
  const maxRow = Math.ceil(maxY / dy);

  const arcs: string[] = [];

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
          `<path d="${buildArcPath(cx, cy, arcRadius)}" fill="none" stroke="rgb(236,244,255)" stroke-opacity="0.115" stroke-width="${strokeWidth.toFixed(2)}" vector-effect="non-scaling-stroke"/>`
        );
      }
    }
  }

  return arcs.join("");
}

export function makeSeigaihaTileSvg(opts: SeigaihaOpts): string {
  const geometry = normalizeTileGeometry(opts.tileSize, opts.radius);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.tileSize}" height="${geometry.tileSize}" viewBox="0 0 ${geometry.tileSize} ${geometry.tileSize}">${makeSeigaihaArcs(geometry)}</svg>`;
}

export function svgToDataUrl(svg: string): string {
  const compact = svg.replace(/\s{2,}/g, " ").replace(/\n/g, "").trim();
  return `data:image/svg+xml,${encodeURIComponent(compact)}`;
}

function initializeSeigaihaImages(): void {
  if (!seigaihaSmallImageUrl) {
    seigaihaSmallImageUrl = `url("${svgToDataUrl(makeSeigaihaTileSvg(SMALL_TILE))}")`;
  }
  if (!seigaihaMediumImageUrl) {
    seigaihaMediumImageUrl = `url("${svgToDataUrl(makeSeigaihaTileSvg(MEDIUM_TILE))}")`;
  }
  if (!seigaihaLargeImageUrl) {
    seigaihaLargeImageUrl = `url("${svgToDataUrl(makeSeigaihaTileSvg(LARGE_TILE))}")`;
  }
}

function motionBoost(now: number): number {
  if (activeMode === "tuner") return 1 + tunerStability * 0.08;
  if (activeMode === "metronome" || activeMode === "drum-machine") {
    return 1 + beatEnvelope(now) * 0.1;
  }
  return 1;
}

function quantizeHalfPx(value: number): number {
  return Math.round(value * 2) / 2;
}

function computeWaveOffsets(now: number): WaveOffsets {
  const t = now * 0.001;
  const boost = motionBoost(now);

  return {
    lx: quantizeHalfPx(Math.sin(t * 0.015) * 24 * boost),
    ly: quantizeHalfPx(Math.cos(t * 0.012) * 18 * boost),
    mx: quantizeHalfPx(Math.sin(t * 0.022) * 36 * boost),
    my: quantizeHalfPx(Math.cos(t * 0.017) * 28 * boost),
    sx: quantizeHalfPx(Math.sin(t * 0.03) * 48 * boost),
    sy: quantizeHalfPx(Math.cos(t * 0.024) * 34 * boost),
  };
}

function applyStaticVars(el: HTMLElement): void {
  initializeSeigaihaImages();

  if (seigaihaSmallImageUrl !== lastApplied.smallImage) {
    el.style.setProperty("--seigaiha-small-image", seigaihaSmallImageUrl);
    lastApplied.smallImage = seigaihaSmallImageUrl;
  }
  if (seigaihaMediumImageUrl !== lastApplied.mediumImage) {
    el.style.setProperty("--seigaiha-medium-image", seigaihaMediumImageUrl);
    lastApplied.mediumImage = seigaihaMediumImageUrl;
  }
  if (seigaihaLargeImageUrl !== lastApplied.largeImage) {
    el.style.setProperty("--seigaiha-large-image", seigaihaLargeImageUrl);
    lastApplied.largeImage = seigaihaLargeImageUrl;
  }

  el.style.setProperty("--card-seigaiha-image", seigaihaMediumImageUrl);
  el.style.setProperty("--seigaiha-small-size", "288px 288px");
  el.style.setProperty("--seigaiha-medium-size", "288px 288px");
  el.style.setProperty("--seigaiha-large-size", "360px 360px");
  el.style.setProperty("--seigaiha-opacity", "0.22");
  el.style.setProperty("--card-seigaiha-opacity", "0.065");
  el.style.setProperty("--seigaiha-grain-opacity", "0");
  el.style.setProperty("--seigaiha-blur", "0px");
}

function applyWaveVars(el: HTMLElement, offsets: WaveOffsets): void {
  if (offsets.lx !== lastApplied.lx) {
    el.style.setProperty("--waveL-x", String(offsets.lx));
    lastApplied.lx = offsets.lx;
  }
  if (offsets.ly !== lastApplied.ly) {
    el.style.setProperty("--waveL-y", String(offsets.ly));
    lastApplied.ly = offsets.ly;
  }
  if (offsets.mx !== lastApplied.mx) {
    el.style.setProperty("--waveM-x", String(offsets.mx));
    lastApplied.mx = offsets.mx;
  }
  if (offsets.my !== lastApplied.my) {
    el.style.setProperty("--waveM-y", String(offsets.my));
    lastApplied.my = offsets.my;
  }
  if (offsets.sx !== lastApplied.sx) {
    el.style.setProperty("--waveS-x", String(offsets.sx));
    lastApplied.sx = offsets.sx;
  }
  if (offsets.sy !== lastApplied.sy) {
    el.style.setProperty("--waveS-y", String(offsets.sy));
    lastApplied.sy = offsets.sy;
  }
}

function render(now: number): void {
  if (!targetEl) return;
  const offsets = computeWaveOffsets(now);
  applyWaveVars(targetEl, offsets);

  if (DEBUG_WAVES && now - debugStartedAt <= DEBUG_DURATION_MS && now - lastDebugLogAt >= 1000) {
    lastDebugLogAt = now;
    console.debug("[seigaiha-waves]", offsets);
  }

  rafId = window.requestAnimationFrame(render);
}

export function applySeigaihaBackground(el: HTMLElement, _noiseLevel: number): void {
  applyStaticVars(el);
  applyWaveVars(el, computeWaveOffsets(performance.now()));
}

export function initializeSeigaihaBackground(el: HTMLElement): void {
  targetEl = el;
  debugStartedAt = performance.now();
  lastDebugLogAt = 0;

  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
  }

  lastApplied = {
    lx: Number.NaN,
    ly: Number.NaN,
    mx: Number.NaN,
    my: Number.NaN,
    sx: Number.NaN,
    sy: Number.NaN,
    smallImage: "",
    mediumImage: "",
    largeImage: "",
  };

  applyStaticVars(el);
  applyWaveVars(el, computeWaveOffsets(performance.now()));
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
