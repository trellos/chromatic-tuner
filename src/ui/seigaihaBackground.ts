import type { ModeId } from "../modes/types.js";

type SeigaihaOpts = {
  tileSize?: number;
  radius?: number;
  noise?: number;
};

type BackgroundMode = ModeId;

const DEFAULT_TILE_SIZE = 256;
const DEFAULT_RADIUS = 48;

let targetEl: HTMLElement | null = null;
let activeMode: BackgroundMode = "tuner";
let beatIntervalMs = 500;
let lastBeatAt = performance.now();
let tunerNoise = 1;
let rafId: number | null = null;
let lastAppliedNoise = -1;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function beatNoise(now: number): number {
  if (beatIntervalMs <= 0) return 1;
  const elapsed = (now - lastBeatAt) % beatIntervalMs;
  const progress = clamp(elapsed / beatIntervalMs);
  return Math.pow(Math.sin(progress * Math.PI), 0.8);
}

function buildArcPath(cx: number, cy: number, radius: number): string {
  return `M ${(cx - radius).toFixed(2)} ${cy.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 0 1 ${(cx + radius).toFixed(2)} ${cy.toFixed(2)}`;
}

export function makeSeigaihaTileSvg(opts: SeigaihaOpts = {}): string {
  const tileSize = opts.tileSize ?? DEFAULT_TILE_SIZE;
  const baseRadius = opts.radius ?? DEFAULT_RADIUS;
  const noise = clamp(opts.noise ?? 0);

  const patternOpacity = lerp(0.06, 0.10, 1 - noise);
  const dx = 2 * baseRadius;
  const dy = baseRadius;
  const radii = [baseRadius, (baseRadius * 2) / 3, baseRadius / 3];
  const strokeWidths = [2.0, 1.6, 1.2];

  const rowCount = Math.ceil((tileSize + dy) / dy) + 2;
  const colCount = Math.ceil((tileSize + dx) / dx) + 3;

  const arcs: string[] = [];
  for (let row = -1; row < rowCount; row++) {
    const cy = row * dy;
    const xOffset = (row % 2) * baseRadius;
    for (let col = -1; col < colCount; col++) {
      const cx = col * dx + xOffset;
      for (let i = 0; i < radii.length; i++) {
        const radius = radii[i] ?? baseRadius;
        const strokeWidth = strokeWidths[i] ?? 1.2;
        arcs.push(
          `<path d="${buildArcPath(cx, cy, radius)}" fill="none" stroke="rgb(232,241,255)" stroke-opacity="${patternOpacity.toFixed(3)}" stroke-width="${strokeWidth.toFixed(2)}" vector-effect="non-scaling-stroke" />`
        );
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tileSize}" height="${tileSize}" viewBox="0 0 ${tileSize} ${tileSize}">${arcs.join("")}</svg>`;
}

function makeGrainSvg(tileSize: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tileSize}" height="${tileSize}" viewBox="0 0 ${tileSize} ${tileSize}">
    <defs>
      <filter id="grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7" stitchTiles="stitch" result="fineNoise" />
        <feColorMatrix in="fineNoise" type="saturate" values="0" result="monoNoise" />
      </filter>
    </defs>
    <rect width="100%" height="100%" filter="url(#grain)" />
  </svg>`;
}

export function svgToDataUrl(svg: string): string {
  const compact = svg.replace(/\s{2,}/g, " ").replace(/\n/g, "").trim();
  return `data:image/svg+xml,${encodeURIComponent(compact)}`;
}

export function applySeigaihaBackground(el: HTMLElement, noise: number): void {
  const clampedNoise = clamp(noise);
  const tileSize = DEFAULT_TILE_SIZE;

  const grainOpacity = lerp(0.0, 0.14, clampedNoise);

  const seigaihaSvg = makeSeigaihaTileSvg({
    tileSize,
    radius: DEFAULT_RADIUS,
    noise: clampedNoise,
  });
  const grainSvg = makeGrainSvg(tileSize);

  el.style.setProperty("--bg-noise", clampedNoise.toFixed(3));
  el.style.setProperty("--seigaiha-image", `url("${svgToDataUrl(seigaihaSvg)}")`);
  el.style.setProperty("--grain-image", `url("${svgToDataUrl(grainSvg)}")`);
  el.style.setProperty("--seigaiha-size", `${tileSize}px ${tileSize}px`);
  el.style.setProperty("--seigaiha-grain-opacity", grainOpacity.toFixed(3));
  el.style.setProperty("--card-seigaiha-opacity", lerp(0.05, 0.09, 1 - clampedNoise).toFixed(3));
}


function renderBackground(now: number): void {
  if (!targetEl) return;

  const modeNoise =
    activeMode === "tuner"
      ? tunerNoise
      : activeMode === "metronome" || activeMode === "drum-machine"
        ? beatNoise(now)
        : 0.25;

  const quantizedNoise = Number(modeNoise.toFixed(2));
  if (quantizedNoise !== lastAppliedNoise) {
    applySeigaihaBackground(targetEl, quantizedNoise);
    lastAppliedNoise = quantizedNoise;
  }

  rafId = window.requestAnimationFrame(renderBackground);
}

export function initializeSeigaihaBackground(el: HTMLElement): void {
  targetEl = el;
  const configuredNoise = Number.parseFloat(
    getComputedStyle(el).getPropertyValue("--bg-noise")
  );
  if (Number.isFinite(configuredNoise)) {
    tunerNoise = clamp(configuredNoise);
  }
  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
  }
  lastAppliedNoise = -1;
  rafId = window.requestAnimationFrame(renderBackground);
}

export function setBackgroundMode(mode: BackgroundMode): void {
  activeMode = mode;
}

export function setTunerBackgroundNoise(cents: number | null, isDetecting: boolean): void {
  if (!isDetecting || cents === null) {
    tunerNoise = 1;
    return;
  }
  tunerNoise = clamp(Math.abs(cents) / 50);
}

export function pulseRhythmBackground(beatMs: number): void {
  beatIntervalMs = Math.max(80, beatMs);
  lastBeatAt = performance.now();
}

export function setRhythmBackgroundIdleNoise(): void {
  lastBeatAt = performance.now() - beatIntervalMs / 2;
}
