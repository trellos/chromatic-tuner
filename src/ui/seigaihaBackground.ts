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
  waveLx: number;
  waveLy: number;
  waveMx: number;
  waveMy: number;
  waveSx: number;
  waveSy: number;
  cardWaveLx: number;
  cardWaveLy: number;
  cardWaveMx: number;
  cardWaveMy: number;
};

const DEBUG_WAVES = true;
const DEBUG_DURATION_MS = 5000;
const TILE_PADDING_CELLS = 2;

const SMALL_TILE: SeigaihaTileSpec = { radius: 32, tileSize: 384 };
const MEDIUM_TILE: SeigaihaTileSpec = { radius: 48, tileSize: 384 };
const LARGE_TILE: SeigaihaTileSpec = { radius: 64, tileSize: 384 };

let targetEl: HTMLElement | null = null;
let activeMode: BackgroundMode = "tuner";
let beatIntervalMs = 500;
let lastBeatAt = performance.now();
let tunerStability = 0;

let rafId: number | null = null;
let debugStartAt = 0;
let lastDebugLogAt = 0;

const tileUrlCache = new Map<string, string>();

let lastWaveState: WaveState = {
  waveLx: Number.NaN,
  waveLy: Number.NaN,
  waveMx: Number.NaN,
  waveMy: Number.NaN,
  waveSx: Number.NaN,
  waveSy: Number.NaN,
  cardWaveLx: Number.NaN,
  cardWaveLy: Number.NaN,
  cardWaveMx: Number.NaN,
  cardWaveMy: Number.NaN,
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function quantizeHalfPixel(value: number): number {
  return Math.round(value * 2) / 2;
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

function applyStaticBackgroundVars(el: HTMLElement): void {
  el.style.setProperty("--seigaiha-small-image", getTileUrl(SMALL_TILE));
  el.style.setProperty("--seigaiha-medium-image", getTileUrl(MEDIUM_TILE));
  el.style.setProperty("--seigaiha-large-image", getTileUrl(LARGE_TILE));

  el.style.setProperty("--seigaiha-small-size", "384px 384px");
  el.style.setProperty("--seigaiha-medium-size", "384px 384px");
  el.style.setProperty("--seigaiha-large-size", "384px 384px");

  el.style.setProperty("--seigaiha-opacity", "0.22");
  el.style.setProperty("--card-seigaiha-opacity", "0.062");
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
  const waveLy = quantizeHalfPixel(Math.cos(t * 0.010) * 16 * boost);
  const waveMx = quantizeHalfPixel(Math.sin(t * 0.018) * 34 * boost);
  const waveMy = quantizeHalfPixel(Math.cos(t * 0.015) * 26 * boost);
  const waveSx = quantizeHalfPixel(Math.sin(t * 0.025) * 46 * boost);
  const waveSy = quantizeHalfPixel(Math.cos(t * 0.021) * 34 * boost);

  return {
    waveLx,
    waveLy,
    waveMx,
    waveMy,
    waveSx,
    waveSy,
    cardWaveLx: quantizeHalfPixel(waveLx * 0.6),
    cardWaveLy: quantizeHalfPixel(waveLy * 0.6),
    cardWaveMx: quantizeHalfPixel(waveMx * 0.6),
    cardWaveMy: quantizeHalfPixel(waveMy * 0.6),
  };
}

function applyWaveVars(el: HTMLElement, state: WaveState): void {
  if (state.waveLx !== lastWaveState.waveLx) {
    el.style.setProperty("--waveL-x", String(state.waveLx));
    lastWaveState.waveLx = state.waveLx;
  }
  if (state.waveLy !== lastWaveState.waveLy) {
    el.style.setProperty("--waveL-y", String(state.waveLy));
    lastWaveState.waveLy = state.waveLy;
  }
  if (state.waveMx !== lastWaveState.waveMx) {
    el.style.setProperty("--waveM-x", String(state.waveMx));
    lastWaveState.waveMx = state.waveMx;
  }
  if (state.waveMy !== lastWaveState.waveMy) {
    el.style.setProperty("--waveM-y", String(state.waveMy));
    lastWaveState.waveMy = state.waveMy;
  }
  if (state.waveSx !== lastWaveState.waveSx) {
    el.style.setProperty("--waveS-x", String(state.waveSx));
    lastWaveState.waveSx = state.waveSx;
  }
  if (state.waveSy !== lastWaveState.waveSy) {
    el.style.setProperty("--waveS-y", String(state.waveSy));
    lastWaveState.waveSy = state.waveSy;
  }

  if (state.cardWaveLx !== lastWaveState.cardWaveLx) {
    el.style.setProperty("--cardWaveL-x", String(state.cardWaveLx));
    lastWaveState.cardWaveLx = state.cardWaveLx;
  }
  if (state.cardWaveLy !== lastWaveState.cardWaveLy) {
    el.style.setProperty("--cardWaveL-y", String(state.cardWaveLy));
    lastWaveState.cardWaveLy = state.cardWaveLy;
  }
  if (state.cardWaveMx !== lastWaveState.cardWaveMx) {
    el.style.setProperty("--cardWaveM-x", String(state.cardWaveMx));
    lastWaveState.cardWaveMx = state.cardWaveMx;
  }
  if (state.cardWaveMy !== lastWaveState.cardWaveMy) {
    el.style.setProperty("--cardWaveM-y", String(state.cardWaveMy));
    lastWaveState.cardWaveMy = state.cardWaveMy;
  }
}

function render(now: number): void {
  if (!targetEl) return;

  const state = computeWaveState(now);
  applyWaveVars(targetEl, state);

  if (
    DEBUG_WAVES &&
    now - debugStartAt <= DEBUG_DURATION_MS &&
    now - lastDebugLogAt >= 1000
  ) {
    lastDebugLogAt = now;
    console.debug("[seigaiha-vars]", {
      waveLx: state.waveLx,
      waveLy: state.waveLy,
      waveMx: state.waveMx,
      waveMy: state.waveMy,
      waveSx: state.waveSx,
      waveSy: state.waveSy,
      cardWaveLx: state.cardWaveLx,
      cardWaveLy: state.cardWaveLy,
      cardWaveMx: state.cardWaveMx,
      cardWaveMy: state.cardWaveMy,
    });
  }

  rafId = window.requestAnimationFrame(render);
}

export function initializeSeigaihaBackground(el: HTMLElement): void {
  targetEl = el;
  debugStartAt = performance.now();
  lastDebugLogAt = 0;

  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
  }

  lastWaveState = {
    waveLx: Number.NaN,
    waveLy: Number.NaN,
    waveMx: Number.NaN,
    waveMy: Number.NaN,
    waveSx: Number.NaN,
    waveSy: Number.NaN,
    cardWaveLx: Number.NaN,
    cardWaveLy: Number.NaN,
    cardWaveMx: Number.NaN,
    cardWaveMy: Number.NaN,
  };

  applyStaticBackgroundVars(el);
  applyWaveVars(el, computeWaveState(performance.now()));
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
