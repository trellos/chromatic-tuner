import type { ModeId } from "../modes/types.js";

type BackgroundMode = ModeId;

type SeigaihaTileSpec = {
  radius: number;
  tileSize: number;
};

type WaveState = {
  waveLX: string;
  waveLY: string;
  waveMX: string;
  waveMY: string;
  waveSX: string;
  waveSY: string;
  cardWaveLX: string;
  cardWaveLY: string;
  cardWaveMX: string;
  cardWaveMY: string;
};

const DEBUG_WAVES = false;
const DEBUG_DURATION_MS = 5000;
const TILE_PADDING_CELLS = 2;

const R_SMALL = 32;
const R_MED = 48;
const R_LARGE = 64;
const TILE_SIZE = 384;

const SMALL_TILE: SeigaihaTileSpec = { radius: R_SMALL, tileSize: TILE_SIZE };
const MEDIUM_TILE: SeigaihaTileSpec = { radius: R_MED, tileSize: TILE_SIZE };
const LARGE_TILE: SeigaihaTileSpec = { radius: R_LARGE, tileSize: TILE_SIZE };

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
  waveLX: "",
  waveLY: "",
  waveMX: "",
  waveMY: "",
  waveSX: "",
  waveSY: "",
  cardWaveLX: "",
  cardWaveLY: "",
  cardWaveMX: "",
  cardWaveMY: "",
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function q(value: number): number {
  return Math.round(value * 2) / 2;
}

function formatVar(value: number): string {
  return q(value).toFixed(1);
}

function arcPath(cx: number, cy: number, radius: number): string {
  return `M ${(cx - radius).toFixed(2)} ${cy.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 1 ${(cx + radius).toFixed(2)} ${cy.toFixed(2)}`;
}

function buildSeigaihaArcs(spec: SeigaihaTileSpec): string {
  const { radius, tileSize } = spec;
  const dx = 2 * radius;
  const dy = radius;

  const radii = [radius, radius * (2 / 3), radius * (1 / 3)];
  const strokeWidths = [radius * 0.048, radius * 0.038, radius * 0.028];

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
        const width = strokeWidths[i] ?? 1;
        arcs.push(
          `<path d="${arcPath(cx, cy, r)}" fill="none" stroke="rgb(236,244,255)" stroke-opacity="0.115" stroke-width="${width.toFixed(2)}" vector-effect="non-scaling-stroke"/>`
        );
      }
    }
  }

  return arcs.join("");
}

function makeSeigaihaTileSvg(spec: SeigaihaTileSpec): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.tileSize}" height="${spec.tileSize}" viewBox="0 0 ${spec.tileSize} ${spec.tileSize}">${buildSeigaihaArcs(spec)}</svg>`;
}

function svgToDataUrl(svg: string): string {
  const compact = svg.replace(/\s{2,}/g, " ").replace(/\n/g, "").trim();
  return `data:image/svg+xml,${encodeURIComponent(compact)}`;
}

function getTileUrl(spec: SeigaihaTileSpec): string {
  const key = `${spec.radius}-${spec.tileSize}`;
  const cached = tileUrlCache.get(key);
  if (cached) {
    return cached;
  }

  const url = `url("${svgToDataUrl(makeSeigaihaTileSvg(spec))}")`;
  tileUrlCache.set(key, url);
  return url;
}

function applyStaticBackgroundVars(root: HTMLElement): void {
  root.style.setProperty("--seigaiha-small-image", getTileUrl(SMALL_TILE));
  root.style.setProperty("--seigaiha-medium-image", getTileUrl(MEDIUM_TILE));
  root.style.setProperty("--seigaiha-large-image", getTileUrl(LARGE_TILE));

  root.style.setProperty("--seigaiha-small-size", `${TILE_SIZE}px ${TILE_SIZE}px`);
  root.style.setProperty("--seigaiha-medium-size", `${TILE_SIZE}px ${TILE_SIZE}px`);
  root.style.setProperty("--seigaiha-large-size", `${TILE_SIZE}px ${TILE_SIZE}px`);
}

function computeWaveState(now: number): WaveState {
  const t = now * 0.001;

  const waveLx = 18 * Math.sin(t * 0.08 + 0.2);
  const waveLy = 18 * Math.cos(t * 0.07 + 1.3);

  const waveMx = 28 * Math.sin(t * 0.13 + 0.9);
  const waveMy = 28 * Math.cos(t * 0.11 + 2.1);

  const waveSx = 40 * Math.sin(t * 0.19 + 1.7);
  const waveSy = 40 * Math.cos(t * 0.16 + 0.4);

  const cardScale = 0.6;

  return {
    waveLX: formatVar(waveLx),
    waveLY: formatVar(waveLy),
    waveMX: formatVar(waveMx),
    waveMY: formatVar(waveMy),
    waveSX: formatVar(waveSx),
    waveSY: formatVar(waveSy),
    cardWaveLX: formatVar(waveLx * cardScale),
    cardWaveLY: formatVar(waveLy * cardScale),
    cardWaveMX: formatVar(waveMx * cardScale),
    cardWaveMY: formatVar(waveMy * cardScale),
  };
}

function applyWaveVars(root: HTMLElement, state: WaveState): void {
  if (state.waveLX !== lastWaveState.waveLX) {
    root.style.setProperty("--waveL-x", state.waveLX);
    lastWaveState.waveLX = state.waveLX;
  }
  if (state.waveLY !== lastWaveState.waveLY) {
    root.style.setProperty("--waveL-y", state.waveLY);
    lastWaveState.waveLY = state.waveLY;
  }
  if (state.waveMX !== lastWaveState.waveMX) {
    root.style.setProperty("--waveM-x", state.waveMX);
    lastWaveState.waveMX = state.waveMX;
  }
  if (state.waveMY !== lastWaveState.waveMY) {
    root.style.setProperty("--waveM-y", state.waveMY);
    lastWaveState.waveMY = state.waveMY;
  }
  if (state.waveSX !== lastWaveState.waveSX) {
    root.style.setProperty("--waveS-x", state.waveSX);
    lastWaveState.waveSX = state.waveSX;
  }
  if (state.waveSY !== lastWaveState.waveSY) {
    root.style.setProperty("--waveS-y", state.waveSY);
    lastWaveState.waveSY = state.waveSY;
  }
  if (state.cardWaveLX !== lastWaveState.cardWaveLX) {
    root.style.setProperty("--cardWaveL-x", state.cardWaveLX);
    lastWaveState.cardWaveLX = state.cardWaveLX;
  }
  if (state.cardWaveLY !== lastWaveState.cardWaveLY) {
    root.style.setProperty("--cardWaveL-y", state.cardWaveLY);
    lastWaveState.cardWaveLY = state.cardWaveLY;
  }
  if (state.cardWaveMX !== lastWaveState.cardWaveMX) {
    root.style.setProperty("--cardWaveM-x", state.cardWaveMX);
    lastWaveState.cardWaveMX = state.cardWaveMX;
  }
  if (state.cardWaveMY !== lastWaveState.cardWaveMY) {
    root.style.setProperty("--cardWaveM-y", state.cardWaveMY);
    lastWaveState.cardWaveMY = state.cardWaveMY;
  }
}

function render(now: number): void {
  if (!rootEl) {
    return;
  }

  const state = computeWaveState(now);
  applyWaveVars(rootEl, state);

  if (DEBUG_WAVES && now - debugStartAt <= DEBUG_DURATION_MS && now - lastDebugLogAt >= 1000) {
    lastDebugLogAt = now;
    console.debug("[seigaiha-vars]", {
      waveL: [state.waveLX, state.waveLY],
      waveM: [state.waveMX, state.waveMY],
      waveS: [state.waveSX, state.waveSY],
      cardL: [state.cardWaveLX, state.cardWaveLY],
      cardM: [state.cardWaveMX, state.cardWaveMY],
    });
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
    waveLX: "",
    waveLY: "",
    waveMX: "",
    waveMY: "",
    waveSX: "",
    waveSY: "",
    cardWaveLX: "",
    cardWaveLY: "",
    cardWaveMX: "",
    cardWaveMY: "",
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
