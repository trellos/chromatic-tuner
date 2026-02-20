import type { ModeId } from "../modes/types.js";

type BackgroundMode = ModeId;

type SeigaihaOpts = {
  tileSize?: number;
  radius?: number;
  noise?: number;
};

const DEFAULT_TILE_SIZE = 256;
const DEFAULT_RADIUS = 48;

const LFO_PERIOD_S = 7;
const LFO_AMPLITUDE = 0.18;
const BASE_NOISE_TUNER = 0.22;
const BASE_NOISE_RHYTHM = 0.18;

let targetEl: HTMLElement | null = null;
let activeMode: BackgroundMode = "tuner";
let beatIntervalMs = 500;
let lastBeatAt = performance.now();
let tunerStability = 0;

let rafId: number | null = null;

let cachedSeigaihaUrl: string | null = null;
let cachedGrainUrl: string | null = null;

let lastApplied = {
  noise: -1,
  seigaihaOpacity: -1,
  grainOpacity: -1,
  blurPx: -1,
  cardOpacity: -1,
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

function lfo(now: number): number {
  const timeSec = now / 1000;
  const phase = (timeSec % LFO_PERIOD_S) / LFO_PERIOD_S;
  return Math.sin(phase * Math.PI * 2);
}

function buildArcPath(cx: number, cy: number, radius: number): string {
  return `M ${(cx - radius).toFixed(2)} ${cy.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 1 ${(cx + radius).toFixed(2)} ${cy.toFixed(2)}`;
}

export function makeSeigaihaTileSvg(opts: SeigaihaOpts = {}): string {
  const tileSize = opts.tileSize ?? DEFAULT_TILE_SIZE;
  const baseRadius = opts.radius ?? DEFAULT_RADIUS;
  const noise = clamp(opts.noise ?? 0);

  const patternOpacity = lerp(0.14, 0.24, 1 - noise);

  const dx = 2 * baseRadius;
  const dy = baseRadius;
  const radii = [baseRadius, (baseRadius * 2) / 3, baseRadius / 3];
  const strokeWidths = [2.0, 1.6, 1.2];

  const rowMin = -2;
  const rowMax = Math.ceil((tileSize + 2 * dy) / dy) + 2;
  const colMin = -2;
  const colMax = Math.ceil((tileSize + 2 * dx) / dx) + 2;

  const paths: string[] = [];

  for (let row = rowMin; row <= rowMax; row++) {
    const cy = row * dy;
    const parity = ((row % 2) + 2) % 2;
    const xOffset = parity * baseRadius;

    for (let col = colMin; col <= colMax; col++) {
      const cx = col * dx + xOffset;

      for (let i = 0; i < radii.length; i++) {
        const radius = radii[i] ?? baseRadius;
        const strokeWidth = strokeWidths[i] ?? 1.2;

        paths.push(
          `<path d="${buildArcPath(cx, cy, radius)}" fill="none" stroke="rgb(232,241,255)" stroke-opacity="${patternOpacity.toFixed(3)}" stroke-width="${strokeWidth.toFixed(2)}" vector-effect="non-scaling-stroke"/>`
        );
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tileSize}" height="${tileSize}" viewBox="0 0 ${tileSize} ${tileSize}">${paths.join("")}</svg>`;
}

function makeGrainTileSvg(tileSize = DEFAULT_TILE_SIZE): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tileSize}" height="${tileSize}" viewBox="0 0 ${tileSize} ${tileSize}">
    <defs>
      <filter id="grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed="7" stitchTiles="stitch" result="noise"/>
        <feColorMatrix in="noise" type="saturate" values="0" result="mono"/>
      </filter>
    </defs>
    <rect width="100%" height="100%" filter="url(#grain)"/>
  </svg>`;
}

export function svgToDataUrl(svg: string): string {
  const compact = svg.replace(/\s{2,}/g, " ").replace(/\n/g, "").trim();
  return `data:image/svg+xml,${encodeURIComponent(compact)}`;
}

function ensureCachedTiles(): void {
  if (!cachedSeigaihaUrl) {
    const seigaihaSvg = makeSeigaihaTileSvg({
      tileSize: DEFAULT_TILE_SIZE,
      radius: DEFAULT_RADIUS,
      noise: 0,
    });
    cachedSeigaihaUrl = `url("${svgToDataUrl(seigaihaSvg)}")`;
  }

  if (!cachedGrainUrl) {
    cachedGrainUrl = `url("${svgToDataUrl(makeGrainTileSvg(DEFAULT_TILE_SIZE))}")`;
  }
}

function applyVars(
  el: HTMLElement,
  vars: {
    noise: number;
    seigaihaOpacity: number;
    grainOpacity: number;
    blurPx: number;
    cardOpacity: number;
  }
): void {
  const epsilon = 0.005;

  if (Math.abs(vars.noise - lastApplied.noise) > epsilon) {
    el.style.setProperty("--bg-noise", vars.noise.toFixed(3));
    lastApplied.noise = vars.noise;
  }

  if (Math.abs(vars.seigaihaOpacity - lastApplied.seigaihaOpacity) > epsilon) {
    el.style.setProperty("--seigaiha-opacity", vars.seigaihaOpacity.toFixed(3));
    lastApplied.seigaihaOpacity = vars.seigaihaOpacity;
  }

  if (Math.abs(vars.grainOpacity - lastApplied.grainOpacity) > epsilon) {
    el.style.setProperty("--seigaiha-grain-opacity", vars.grainOpacity.toFixed(3));
    lastApplied.grainOpacity = vars.grainOpacity;
  }

  if (Math.abs(vars.blurPx - lastApplied.blurPx) > epsilon) {
    el.style.setProperty("--seigaiha-blur", `${vars.blurPx.toFixed(3)}px`);
    lastApplied.blurPx = vars.blurPx;
  }

  if (Math.abs(vars.cardOpacity - lastApplied.cardOpacity) > epsilon) {
    el.style.setProperty("--card-seigaiha-opacity", vars.cardOpacity.toFixed(3));
    lastApplied.cardOpacity = vars.cardOpacity;
  }

  el.style.setProperty("--seigaiha-image", cachedSeigaihaUrl ?? "none");
  el.style.setProperty("--grain-image", cachedGrainUrl ?? "none");
  el.style.setProperty("--seigaiha-size", `${DEFAULT_TILE_SIZE}px ${DEFAULT_TILE_SIZE}px`);
}

function render(now: number): void {
  if (!targetEl) return;

  ensureCachedTiles();

  const lfoOffset = lfo(now);
  let baseNoise = activeMode === "tuner" ? BASE_NOISE_TUNER : BASE_NOISE_RHYTHM;

  if (activeMode === "tuner") {
    baseNoise = clamp(baseNoise + tunerStability * 0.35);
  }

  if (activeMode === "metronome" || activeMode === "drum-machine") {
    baseNoise = clamp(baseNoise + beatEnvelope(now) * 0.35);
  }

  const noise = clamp(baseNoise + lfoOffset * LFO_AMPLITUDE);

  const seigaihaOpacity = lerp(0.14, 0.24, 1 - noise);
  const grainOpacity = lerp(0.0, 0.14, noise);
  const blurPx = lerp(0.0, 0.8, noise);
  const cardOpacity = lerp(0.05, 0.10, 1 - noise);

  applyVars(targetEl, {
    noise,
    seigaihaOpacity,
    grainOpacity,
    blurPx,
    cardOpacity,
  });

  rafId = window.requestAnimationFrame(render);
}

export function applySeigaihaBackground(el: HTMLElement, noise: number): void {
  ensureCachedTiles();
  const clampedNoise = clamp(noise);
  applyVars(el, {
    noise: clampedNoise,
    seigaihaOpacity: lerp(0.14, 0.24, 1 - clampedNoise),
    grainOpacity: lerp(0.0, 0.14, clampedNoise),
    blurPx: lerp(0.0, 0.8, clampedNoise),
    cardOpacity: lerp(0.05, 0.10, 1 - clampedNoise),
  });
}

export function initializeSeigaihaBackground(el: HTMLElement): void {
  targetEl = el;
  ensureCachedTiles();

  const configured = Number.parseFloat(
    getComputedStyle(el).getPropertyValue("--bg-noise")
  );
  if (Number.isFinite(configured)) {
    tunerStability = clamp(configured);
  }

  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
  }

  lastApplied = {
    noise: -1,
    seigaihaOpacity: -1,
    grainOpacity: -1,
    blurPx: -1,
    cardOpacity: -1,
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
