import type { ModeId } from "../modes/types.js";

type BackgroundMode = ModeId;

type SeigaihaTileSpec = {
  radius: number;
  tileSize: number;
};

type TileGeometry = {
  radius: number;
  tileSize: number;
  dx: number;
  dy: number;
};

type WaveState = {
  waveLPos: string;
  waveMPos: string;
  waveSPos: string;
  cardWaveLPos: string;
  cardWaveMPos: string;
};

const DEBUG_WAVES = true;
const DEBUG_DURATION_MS = 5000;
const TILE_PADDING_CELLS = 2;

const SMALL_TILE: SeigaihaTileSpec = { radius: 32, tileSize: 384 };
const MEDIUM_TILE: SeigaihaTileSpec = { radius: 48, tileSize: 384 };
const LARGE_TILE: SeigaihaTileSpec = { radius: 64, tileSize: 384 };

let activeMode: BackgroundMode = "tuner";
let beatIntervalMs = 500;
let lastBeatAt = performance.now();
let tunerStability = 0;

let rafId: number | null = null;
let debugStartAt = 0;
let lastDebugLogAt = 0;

let rootEl: HTMLElement | null = null;

const tileUrlCache = new Map<string, string>();

let lastWaveState: WaveState = {
  waveLPos: "",
  waveMPos: "",
  waveSPos: "",
  cardWaveLPos: "",
  cardWaveMPos: "",
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function quantizeHalfPixel(value: number): number {
  return Math.round(value * 2) / 2;
}

function pos(x: number, y: number): string {
  return `${x}px ${y}px`;
}

function beatEnvelope(now: number): number {
  if (beatIntervalMs <= 0) return 0;
  const elapsed = (now - lastBeatAt) % beatIntervalMs;
  const progress = clamp(elapsed / beatIntervalMs);
  return Math.pow(Math.sin(progress * Math.PI), 0.85);
}

function normalizeTileGeometry(spec: SeigaihaTileSpec): TileGeometry {
  const radius = Math.max(8, Math.round(spec.radius));
  const dx = 2 * radius;
  const dy = radius;
  const period = Math.max(dx, 2 * dy);
  const tileSize = Math.max(period, Math.round(spec.tileSize / period) * period);
  return { radius, tileSize, dx, dy };
}

function arcPath(cx: number, cy: number, radius: number): string {
  return `M ${(cx - radius).toFixed(2)} ${cy.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 1 ${(cx + radius).toFixed(2)} ${cy.toFixed(2)}`;
}

function buildSeigaihaArcs(geometry: TileGeometry): string {
  const { radius, tileSize, dx, dy } = geometry;
  const radii = [radius, radius * (2 / 3), radius * (1 / 3)];
  const strokeWidths = [radius * 0.046, radius * 0.036, radius * 0.027];

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
        const r = radii[i] ?? radius;
        const width = strokeWidths[i] ?? 1.2;
        arcs.push(
          `<path d="${arcPath(cx, cy, r)}" fill="none" stroke="rgb(236,244,255)" stroke-opacity="0.115" stroke-width="${width.toFixed(2)}" vector-effect="non-scaling-stroke"/>`
        );
      }
    }
  }

  return arcs.join("");
}

function makeSeigaihaTileSvg(spec: SeigaihaTileSpec): string {
  const geometry = normalizeTileGeometry(spec);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.tileSize}" height="${geometry.tileSize}" viewBox="0 0 ${geometry.tileSize} ${geometry.tileSize}">${buildSeigaihaArcs(geometry)}</svg>`;
}

function svgToDataUrl(svg: string): string {
  const compact = svg.replace(/\s{2,}/g, " ").replace(/\n/g, "").trim();
  return `data:image/svg+xml,${encodeURIComponent(compact)}`;
}

function getTileUrl(spec: SeigaihaTileSpec): string {
  const key = `${spec.radius}-${spec.tileSize}`;
  const cached = tileUrlCache.get(key);
  if (cached) return cached;

  const url = `url("${svgToDataUrl(makeSeigaihaTileSvg(spec))}")`;
  tileUrlCache.set(key, url);
  return url;
}

function applyStaticBackgroundVars(root: HTMLElement): void {
  root.style.setProperty("--seigaiha-small-image", getTileUrl(SMALL_TILE));
  root.style.setProperty("--seigaiha-medium-image", getTileUrl(MEDIUM_TILE));
  root.style.setProperty("--seigaiha-large-image", getTileUrl(LARGE_TILE));

  root.style.setProperty("--seigaiha-small-size", "384px 384px");
  root.style.setProperty("--seigaiha-medium-size", "384px 384px");
  root.style.setProperty("--seigaiha-large-size", "384px 384px");

  root.style.setProperty("--seigaiha-opacity", "0.22");
  root.style.setProperty("--card-seigaiha-opacity", "0.062");
}

function motionBoost(now: number): number {
  if (activeMode === "tuner") {
    return 1 + tunerStability * 0.08;
  }
  if (activeMode === "metronome" || activeMode === "drum-machine") {
    return 1 + beatEnvelope(now) * 0.1;
  }
  return 1;
}

function computeWaveState(now: number): WaveState {
  const t = now * 0.001;
  const boost = motionBoost(now);

  const waveLx = quantizeHalfPixel(Math.sin(t * 0.012) * 22 * boost);
  const waveLy = quantizeHalfPixel(Math.cos(t * 0.01) * 16 * boost);
  const waveMx = quantizeHalfPixel(Math.sin(t * 0.018) * 34 * boost);
  const waveMy = quantizeHalfPixel(Math.cos(t * 0.015) * 26 * boost);
  const waveSx = quantizeHalfPixel(Math.sin(t * 0.025) * 46 * boost);
  const waveSy = quantizeHalfPixel(Math.cos(t * 0.021) * 34 * boost);

  return {
    waveLPos: pos(waveLx, waveLy),
    waveMPos: pos(waveMx, waveMy),
    waveSPos: pos(waveSx, waveSy),
    cardWaveLPos: pos(quantizeHalfPixel(waveLx * 0.6), quantizeHalfPixel(waveLy * 0.6)),
    cardWaveMPos: pos(quantizeHalfPixel(waveMx * 0.6), quantizeHalfPixel(waveMy * 0.6)),
  };
}

function applyWaveVars(root: HTMLElement, state: WaveState): void {
  if (state.waveLPos !== lastWaveState.waveLPos) {
    root.style.setProperty("--waveL-pos", state.waveLPos);
    lastWaveState.waveLPos = state.waveLPos;
  }
  if (state.waveMPos !== lastWaveState.waveMPos) {
    root.style.setProperty("--waveM-pos", state.waveMPos);
    lastWaveState.waveMPos = state.waveMPos;
  }
  if (state.waveSPos !== lastWaveState.waveSPos) {
    root.style.setProperty("--waveS-pos", state.waveSPos);
    lastWaveState.waveSPos = state.waveSPos;
  }
  if (state.cardWaveLPos !== lastWaveState.cardWaveLPos) {
    root.style.setProperty("--cardWaveL-pos", state.cardWaveLPos);
    lastWaveState.cardWaveLPos = state.cardWaveLPos;
  }
  if (state.cardWaveMPos !== lastWaveState.cardWaveMPos) {
    root.style.setProperty("--cardWaveM-pos", state.cardWaveMPos);
    lastWaveState.cardWaveMPos = state.cardWaveMPos;
  }
}

function render(now: number): void {
  if (!rootEl) return;

  const state = computeWaveState(now);
  applyWaveVars(rootEl, state);

  if (
    DEBUG_WAVES &&
    now - debugStartAt <= DEBUG_DURATION_MS &&
    now - lastDebugLogAt >= 1000
  ) {
    lastDebugLogAt = now;
    console.debug("[seigaiha-vars]", state);
  }

  rafId = window.requestAnimationFrame(render);
}

export function initializeSeigaihaBackground(_el: HTMLElement): void {
  rootEl = document.documentElement;
  debugStartAt = performance.now();
  lastDebugLogAt = 0;

  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
  }

  lastWaveState = {
    waveLPos: "",
    waveMPos: "",
    waveSPos: "",
    cardWaveLPos: "",
    cardWaveMPos: "",
  };

  applyStaticBackgroundVars(rootEl);
  applyWaveVars(rootEl, computeWaveState(performance.now()));
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
