import {
  createSeigaihaWebGlRenderer,
  type SeigaihaRendererBackend,
  type SeigaihaWebGlRenderer,
} from "./seigaihaWebglRenderer.js";
import { clamp } from "../utils.js";

function svgToDataUrl(svg: string): string {
  const encoded = encodeURIComponent(svg)
    .replace(/%0A/g, "")
    .replace(/%09/g, "");
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

function semiAnnulusPath(cx: number, cy: number, rOuter: number, rInner: number): string {
  return [
    `M ${cx - rOuter} ${cy}`,
    `A ${rOuter} ${rOuter} 0 0 1 ${cx + rOuter} ${cy}`,
    `L ${cx + rInner} ${cy}`,
    `A ${rInner} ${rInner} 0 0 0 ${cx - rInner} ${cy}`,
    "Z",
  ].join(" ");
}

function hash01(x: number, y: number, seed: number): number {
  let h = ((x | 0) * 374761393) ^ ((y | 0) * 668265263) ^ ((seed | 0) * 1442695041);
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function quantizeRandomness(value: number): number {
  const clamped = clamp(value, 0, 1);
  const q = Math.round(clamped / RANDOMNESS_CACHE_STEP) * RANDOMNESS_CACHE_STEP;
  return clamp(q, 0, 1);
}

function pickInterpolationSteps(): number {
  const isMobileLike =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
  return isMobileLike ? MOBILE_INTERPOLATION_STEPS : DESKTOP_INTERPOLATION_STEPS;
}

function stepToRandomness(step: number, stepCount: number): number {
  if (stepCount <= 0) return 0;
  return quantizeRandomness(step / stepCount);
}

function pushFrameTimeSample(nowMs: number): void {
  const last = seigaihaState.perfLastSampleAtMs;
  seigaihaState.perfLastSampleAtMs = nowMs;
  if (last <= 0) return;
  const dtMs = clamp(nowMs - last, 0, 1000);
  const index = seigaihaState.frameTimesWriteIndex;
  seigaihaState.frameTimesMs[index] = dtMs;
  seigaihaState.frameTimesWriteIndex = (index + 1) % FRAME_TIME_SAMPLE_CAPACITY;
  seigaihaState.frameTimesCount = Math.min(
    FRAME_TIME_SAMPLE_CAPACITY,
    seigaihaState.frameTimesCount + 1
  );
}

function recordRenderSwap(nowMs: number): void {
  recordRecentEvent(seigaihaState.renderSwapAtMs, nowMs);
}

function recordRenderDraw(nowMs: number): void {
  recordRecentEvent(seigaihaState.renderDrawAtMs, nowMs);
}

function recordTextureUpload(nowMs: number): void {
  recordRecentEvent(seigaihaState.textureUploadAtMs, nowMs);
}

function recordRecentEvent(target: number[], nowMs: number): void {
  target.push(nowMs);
  pruneRecentEvents(target, nowMs);
}

function pruneRecentEvents(target: number[], nowMs: number): void {
  const cutoff = nowMs - SWAP_SAMPLE_WINDOW_MS;
  while (target.length > 0) {
    const first = target[0];
    if (first === undefined || first >= cutoff) break;
    target.shift();
  }
}

function countRecentEvents(target: number[], nowMs: number): number {
  pruneRecentEvents(target, nowMs);
  return target.length;
}

function resolveInterpolatedFrames(randomness: number): {
  keyA: number;
  keyB: number;
  blendA: number;
  blendB: number;
} {
  return resolveSeigaihaInterpolationForTest(randomness, pickInterpolationSteps());
}

export function quantizeSeigaihaRandomnessForCache(value: number): number {
  return quantizeRandomness(value);
}

export function resolveSeigaihaInterpolationForTest(
  randomness: number,
  stepCount: number
): {
  keyA: number;
  keyB: number;
  blendA: number;
  blendB: number;
} {
  const steps = Math.max(1, Math.floor(stepCount));
  const clamped = clamp(randomness, 0, 1);
  const scaled = clamped * steps;
  const i0 = Math.floor(scaled);
  const i1 = Math.min(steps, i0 + 1);
  const blendB = clamp(i1 === i0 ? 0 : scaled - i0, 0, 1);
  return {
    keyA: stepToRandomness(i0, steps),
    keyB: stepToRandomness(i1, steps),
    blendA: clamp(1 - blendB, 0, 1),
    blendB,
  };
}

type SeigaihaState = {
  randomness: number;
  interactionPulseRandomness: number;
  interactionPulsePeak: number;
  interactionPulseStartAtMs: number;
  interactionPulseDurationMs: number;
  interactionPulseRaf: number | null;
  seed: number;
  mapping: SeigaihaMappingPoint[];
  lastDetuneAbsCents: number | null;
  noNoteDecayStartAt: number | null;
  noNoteDecayStartRandomness: number;
  debugOverrideEnabled: boolean;
  debugOverrideRandomness: number;
  noNoteDecayRaf: number | null;
  modeRandomness: number | null;
  patternCache: Map<number, CachedPattern>;
  renderer: SeigaihaWebGlRenderer | null;
  rendererBackend: SeigaihaRendererBackend;
  rendererInitAttempted: boolean;
  renderCount: number;
  lastRenderAtMs: number;
  renderSwapAtMs: number[];
  renderDrawAtMs: number[];
  textureUploadAtMs: number[];
  tunerTargetRandomness: number | null;
  tunerSmoothingRaf: number | null;
  tunerSmoothingLastAtMs: number;
  tunerSmoothingTimeConstantMs: number;
  installedPatternKeyA: number | null;
  installedPatternKeyB: number | null;
  installedBlendA: number;
  installedBlendB: number;
  cacheLookups: number;
  cacheHits: number;
  cacheMisses: number;
  frameTimesMs: number[];
  frameTimesWriteIndex: number;
  frameTimesCount: number;
  perfLastSampleAtMs: number;
  prewarmQueue: number[];
  prewarmTimer: number | null;
};

export type SeigaihaMappingPoint = {
  cents: number;
  randomness: number;
};

type CachedPattern = {
  dataUrl: string;
  tileWidth: number;
  tileHeight: number;
  texture: WebGLTexture | null;
  textureReady: boolean;
  textureLoading: boolean;
  textureFailed: boolean;
};

export type SeigaihaPerformanceStats = {
  avgFps: number;
  p95FrameTimeMs: number;
  maxFrameTimeMs: number;
  renderSwapsPerSec: number;
  renderDrawsPerSec: number;
  textureUploadsPerSec: number;
  cacheLookups: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  cacheSize: number;
  cacheMaxEntries: number;
  sampleCount: number;
};

export type SeigaihaRandomnessDriver = "debug" | "mode" | "tuner" | "none";

const NO_NOTE_DECAY_MS = 1000;
const DEFAULT_TUNER_SMOOTHING_TIME_CONSTANT_MS = 220;
const RANDOMNESS_CACHE_STEP = 1 / 480;
const RANDOMNESS_CACHE_MAX_ENTRIES = 640;
const DESKTOP_INTERPOLATION_STEPS = 96;
const MOBILE_INTERPOLATION_STEPS = 48;
const SWAP_SAMPLE_WINDOW_MS = 1000;
const FRAME_TIME_SAMPLE_CAPACITY = 240;
const PREWARM_RADIUS = 3;
const PREWARM_BATCH_SIZE = 2;
const PREWARM_DELAY_MS = 8;
const BUTTON_PULSE_MIN_RANDOMNESS = 0.2;
const BUTTON_PULSE_MAX_RANDOMNESS = 0.4;
const BUTTON_PULSE_DURATION_MS = 500;
const DEFAULT_MAPPING: SeigaihaMappingPoint[] = [
  { cents: 2, randomness: 0 },
  { cents: 4, randomness: 0.2 },
  { cents: 10, randomness: 0.5 },
];

const seigaihaState: SeigaihaState = {
  randomness: 0,
  interactionPulseRandomness: 0,
  interactionPulsePeak: 0,
  interactionPulseStartAtMs: 0,
  interactionPulseDurationMs: BUTTON_PULSE_DURATION_MS,
  interactionPulseRaf: null,
  seed: 1337,
  mapping: DEFAULT_MAPPING.map((point) => ({ ...point })),
  lastDetuneAbsCents: null,
  noNoteDecayStartAt: null,
  noNoteDecayStartRandomness: 0,
  debugOverrideEnabled: false,
  debugOverrideRandomness: 0,
  noNoteDecayRaf: null,
  modeRandomness: null,
  patternCache: new Map(),
  renderer: null,
  rendererBackend: "none",
  rendererInitAttempted: false,
  renderCount: 0,
  lastRenderAtMs: 0,
  renderSwapAtMs: [],
  renderDrawAtMs: [],
  textureUploadAtMs: [],
  tunerTargetRandomness: null,
  tunerSmoothingRaf: null,
  tunerSmoothingLastAtMs: 0,
  tunerSmoothingTimeConstantMs: DEFAULT_TUNER_SMOOTHING_TIME_CONSTANT_MS,
  installedPatternKeyA: null,
  installedPatternKeyB: null,
  installedBlendA: -1,
  installedBlendB: -1,
  cacheLookups: 0,
  cacheHits: 0,
  cacheMisses: 0,
  frameTimesMs: new Array<number>(FRAME_TIME_SAMPLE_CAPACITY).fill(0),
  frameTimesWriteIndex: 0,
  frameTimesCount: 0,
  perfLastSampleAtMs: 0,
  prewarmQueue: [],
  prewarmTimer: null,
};

export function generateTraditionalSeigaihaSvg(options: {
  radius: number;
  paperColor: string;
  inkColor: string;
  accentInkColor?: string;
  randomness?: number;
  seed?: number;
}): { svg: string; tileWidth: number; tileHeight: number } {
  const {
    radius: r,
    paperColor,
    inkColor,
    accentInkColor = "#7c3aed",
    randomness = 0,
    seed = 1337,
  } = options;

  // Slight horizontal overlap between neighbors.
  const stepX = r * 1.65;
  // Upper-row centers sit inside the largest band of the row below.
  const stepY = r * 0.55;
  const randomnessClamped = clamp(randomness, 0, 1);
  const rowPeriod = 20;
  const colPeriod = 12;

  const tileWidth = stepX * colPeriod;
  const tileHeight = stepY * rowPeriod;

  // Equal-width alternating rings:
  // white, blue, white, blue, white, blue, white, blue(center).
  // This keeps all white bands equal and all blue bands equal.
  const ringStep = 1 / 8;
  const whiteBands: Array<[number, number]> = [
    [1 - ringStep * 0, 1 - ringStep * 1],
    [1 - ringStep * 2, 1 - ringStep * 3],
    [1 - ringStep * 4, 1 - ringStep * 5],
    [1 - ringStep * 6, 1 - ringStep * 7],
  ];
  const blueBands: Array<[number, number]> = [
    [1 - ringStep * 1, 1 - ringStep * 2],
    [1 - ringStep * 3, 1 - ringStep * 4],
    [1 - ringStep * 5, 1 - ringStep * 6],
    [1 - ringStep * 7, 0],
  ];

  const maxRadiusShrink = 0.46 * randomnessClamped;
  const activeShrinkChance = randomnessClamped;
  const maxNeighborPull = stepX * 0.42;
  const minX = -stepX * 2;
  const minY = -stepY * 2;
  const maxX = tileWidth + stepX * 2;
  const maxY = tileHeight + stepY * 2;
  const rows = Math.ceil((maxY - minY) / stepY) + 1;
  const cycleMin = -2;
  const cycleMax = 2;

  const allRowsParts: string[] = [];

  // Paint top->bottom so each lower row sits in front.
  for (let row = 0; row < rows; row++) {
    const cy = minY + row * stepY;
    const xOffset = (row % 2) * (stepX * 0.5);
    const periodicRow = mod(row, rowPeriod);
    const shrinkByCol = new Array<number>(colPeriod).fill(0);
    const radiusByCol = new Array<number>(colPeriod).fill(r);
    const edgeCompaction = new Array<number>(colPeriod).fill(0);
    const localStepByCol = new Array<number>(colPeriod).fill(stepX);
    const centerByCol = new Array<number>(colPeriod).fill(0);
    const rowBluePaths: string[] = [];
    const rowWhitePaths: string[] = [];
    const rowAccentPaths: string[] = [];

    // Build a periodic row pattern so background tiling seams stay clean.
    for (let col = 0; col < colPeriod; col++) {
      const activation = hash01(periodicRow, col, seed + 401);
      const shrinkShape = hash01(periodicRow, col, seed + 947);
      const isActive = activation < activeShrinkChance;
      const shrink = isActive ? maxRadiusShrink * shrinkShape : 0;
      shrinkByCol[col] = shrink;
      radiusByCol[col] = r * (1 - shrink);
    }

    for (let col = 0; col < colPeriod; col++) {
      const nextCol = (col + 1) % colPeriod;
      const pairShrink = ((shrinkByCol[col] ?? 0) + (shrinkByCol[nextCol] ?? 0)) * 0.5;
      edgeCompaction[col] = clamp(stepX * (0.72 * pairShrink), 0, maxNeighborPull);
      localStepByCol[col] = stepX - (edgeCompaction[col] ?? 0);
    }

    const rawPeriodWidth = localStepByCol.reduce((sum, value) => sum + value, 0);
    const widthCorrection = (tileWidth - rawPeriodWidth) / colPeriod;
    for (let col = 0; col < colPeriod; col++) {
      localStepByCol[col] = (localStepByCol[col] ?? 0) + widthCorrection;
    }

    let cursorX = 0;
    for (let col = 0; col < colPeriod; col++) {
      centerByCol[col] = cursorX;
      cursorX += localStepByCol[col] ?? 0;
    }

    const waves: Array<{ cx: number; radius: number; col: number }> = [];
    for (let cycle = cycleMin; cycle <= cycleMax; cycle++) {
      for (let col = 0; col < colPeriod; col++) {
        const cx = (centerByCol[col] ?? 0) + cycle * tileWidth + xOffset;
        const waveR = radiusByCol[col] ?? r;
        if (cx + waveR < minX || cx - waveR > maxX) continue;
        waves.push({ cx, radius: waveR, col });
      }
    }

    // Paint right->left so each wave overdraws the right neighbor corner.
    waves.sort((a, b) => b.cx - a.cx);
    for (const wave of waves) {
      rowBluePaths.push(
        `<path fill="${inkColor}" d="${semiAnnulusPath(wave.cx, cy, wave.radius, 0)}" />`
      );
      for (const [kOuter, kInner] of whiteBands) {
        rowWhitePaths.push(
          `<path d="${semiAnnulusPath(wave.cx, cy, wave.radius * kOuter, wave.radius * kInner)}" />`
        );
      }
      for (let bandIndex = 0; bandIndex < blueBands.length; bandIndex++) {
        const band = blueBands[bandIndex];
        if (!band) continue;
        const [kOuter, kInner] = band;
        const activationThreshold =
          hash01(periodicRow, wave.col * 41 + bandIndex, seed + 1777) * 1.35;
        const fade = clamp((randomnessClamped - activationThreshold) / 0.22, 0, 1);
        if (fade <= 0) continue;
        rowAccentPaths.push(
          `<path fill="${accentInkColor}" fill-opacity="${fade.toFixed(3)}" d="${semiAnnulusPath(wave.cx, cy, wave.radius * kOuter, wave.radius * kInner)}" />`
        );
      }
    }

    allRowsParts.push(
      `<g><g>${rowBluePaths.join("")}</g><g fill="${paperColor}">${rowWhitePaths.join("")}</g><g>${rowAccentPaths.join("")}</g></g>`
    );
  }

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="${tileHeight}" viewBox="0 0 ${tileWidth} ${tileHeight}">
  <rect width="100%" height="100%" fill="${paperColor}"/>
  ${allRowsParts.join("")}
</svg>`.trim();

  return { svg, tileWidth, tileHeight };
}

function ensureRenderer(): SeigaihaWebGlRenderer | null {
  if (seigaihaState.rendererInitAttempted) {
    return seigaihaState.renderer;
  }
  seigaihaState.rendererInitAttempted = true;
  seigaihaState.renderer = createSeigaihaWebGlRenderer();
  seigaihaState.rendererBackend = seigaihaState.renderer.backend;
  if (typeof document !== "undefined") {
    document.body.setAttribute(
      "data-seigaiha-render-ready",
      seigaihaState.rendererBackend === "webgl" ? "0" : "na"
    );
  }
  return seigaihaState.renderer;
}

function disposePatternTexture(pattern: CachedPattern): void {
  if (!pattern.texture) return;
  seigaihaState.renderer?.deleteTexture(pattern.texture);
  pattern.texture = null;
  pattern.textureReady = false;
  pattern.textureLoading = false;
}

function getOrCreateCachedPattern(randomness: number): CachedPattern {
  const key = quantizeRandomness(randomness);
  seigaihaState.cacheLookups += 1;
  const existing = seigaihaState.patternCache.get(key);
  if (existing) {
    seigaihaState.cacheHits += 1;
    return existing;
  }
  seigaihaState.cacheMisses += 1;

  const { svg, tileWidth, tileHeight } = generateTraditionalSeigaihaSvg({
    radius: 40,
    paperColor: "#111e42",
    inkColor: "#080e25",
    accentInkColor: "#1c3060",
    randomness: key,
    seed: seigaihaState.seed,
  });

  const created: CachedPattern = {
    dataUrl: svgToDataUrl(svg),
    tileWidth,
    tileHeight,
    texture: null,
    textureReady: false,
    textureLoading: false,
    textureFailed: false,
  };
  seigaihaState.patternCache.set(key, created);

  // Basic FIFO eviction to bound memory while keeping recent frames hot.
  if (seigaihaState.patternCache.size > RANDOMNESS_CACHE_MAX_ENTRIES) {
    const oldestKey = seigaihaState.patternCache.keys().next().value;
    if (oldestKey !== undefined) {
      const oldest = seigaihaState.patternCache.get(oldestKey);
      if (oldest) {
        disposePatternTexture(oldest);
      }
      seigaihaState.patternCache.delete(oldestKey);
    }
  }

  return created;
}

function enqueuePrewarmKey(key: number): void {
  const quantized = quantizeRandomness(key);
  if (seigaihaState.patternCache.has(quantized)) return;
  if (seigaihaState.prewarmQueue.includes(quantized)) return;
  seigaihaState.prewarmQueue.push(quantized);
}

function schedulePrewarmWork(): void {
  if (typeof window === "undefined") return;
  if (seigaihaState.prewarmTimer !== null) return;
  seigaihaState.prewarmTimer = window.setTimeout(() => {
    seigaihaState.prewarmTimer = null;
    processPrewarmQueue();
  }, PREWARM_DELAY_MS);
}

function processPrewarmQueue(): void {
  const renderer = ensureRenderer();
  if (!renderer || renderer.backend === "none") return;
  for (let i = 0; i < PREWARM_BATCH_SIZE; i++) {
    const key = seigaihaState.prewarmQueue.shift();
    if (key === undefined) break;
    const pattern = getOrCreateCachedPattern(key);
    uploadPatternTextureWhenReady(pattern, renderer);
  }
  if (seigaihaState.prewarmQueue.length > 0) {
    schedulePrewarmWork();
  }
}

function prewarmPatternNeighborhood(frame: { keyA: number; keyB: number }): void {
  const bases = frame.keyA === frame.keyB ? [frame.keyA] : [frame.keyA, frame.keyB];
  for (const base of bases) {
    for (let offset = 1; offset <= PREWARM_RADIUS; offset++) {
      const delta = offset * RANDOMNESS_CACHE_STEP;
      enqueuePrewarmKey(base - delta);
      enqueuePrewarmKey(base + delta);
    }
  }
  schedulePrewarmWork();
}

function uploadPatternTextureWhenReady(
  pattern: CachedPattern,
  renderer: SeigaihaWebGlRenderer
): void {
  if (pattern.textureReady || pattern.textureLoading || pattern.textureFailed) {
    return;
  }
  const texture = pattern.texture ?? renderer.createTexture();
  if (!texture) {
    pattern.textureFailed = true;
    return;
  }
  pattern.texture = texture;
  pattern.textureLoading = true;

  const image = new Image();
  image.onload = () => {
    const uploaded = renderer.uploadTexture(texture, image);
    pattern.textureLoading = false;
    pattern.textureReady = uploaded;
    pattern.textureFailed = !uploaded;
    if (uploaded) {
      recordTextureUpload(performance.now());
      installSeigaihaBackground();
    }
  };
  image.onerror = () => {
    pattern.textureLoading = false;
    pattern.textureFailed = true;
  };
  image.src = pattern.dataUrl;
}

function normalizeMapping(points: SeigaihaMappingPoint[]): SeigaihaMappingPoint[] {
  const cleaned = points
    .filter(
      (point) =>
        Number.isFinite(point.cents) &&
        Number.isFinite(point.randomness) &&
        point.cents >= 0
    )
    .map((point) => ({
      cents: Math.max(0, point.cents),
      randomness: clamp(point.randomness, 0, 1),
    }))
    .sort((a, b) => a.cents - b.cents);

  if (cleaned.length === 0) {
    return DEFAULT_MAPPING.map((point) => ({ ...point }));
  }

  const deduped: SeigaihaMappingPoint[] = [];
  for (const point of cleaned) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.cents - point.cents) < 1e-6) {
      prev.randomness = point.randomness;
      continue;
    }
    deduped.push({ ...point });
  }
  return deduped;
}

export function mapSeigaihaDetuneToRandomness(absCents: number): number {
  if (!Number.isFinite(absCents)) {
    return 0;
  }
  const points = seigaihaState.mapping;
  if (points.length === 0) {
    return 0;
  }

  const x = Math.max(0, absCents);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) {
    return 0;
  }
  if (x <= first.cents) {
    return first.randomness;
  }
  if (x >= last.cents) {
    return last.randomness;
  }

  for (let i = 1; i < points.length; i++) {
    const left = points[i - 1];
    const right = points[i];
    if (!left || !right) continue;
    if (x > right.cents) continue;
    const range = right.cents - left.cents;
    if (range <= 0) {
      return right.randomness;
    }
    const t = (x - left.cents) / range;
    return left.randomness + (right.randomness - left.randomness) * t;
  }

  return last.randomness;
}

function applyRandomness(randomness: number): void {
  pushFrameTimeSample(performance.now());
  const next = clamp(randomness, 0, 1);
  seigaihaState.randomness = next;
  installSeigaihaBackground();
}

function getEffectiveRandomness(): number {
  return clamp(
    Math.max(seigaihaState.randomness, seigaihaState.interactionPulseRandomness),
    0,
    1
  );
}

function stopInteractionPulseLoop(): void {
  if (seigaihaState.interactionPulseRaf !== null) {
    cancelAnimationFrame(seigaihaState.interactionPulseRaf);
    seigaihaState.interactionPulseRaf = null;
  }
}

function tickInteractionPulse(now: number): void {
  const durationMs = Math.max(1, seigaihaState.interactionPulseDurationMs);
  const elapsedMs = Math.max(0, now - seigaihaState.interactionPulseStartAtMs);
  const t = clamp(elapsedMs / durationMs, 0, 1);
  seigaihaState.interactionPulseRandomness = seigaihaState.interactionPulsePeak * (1 - t);
  installSeigaihaBackground();

  if (t >= 1 || seigaihaState.interactionPulseRandomness <= 0.0005) {
    seigaihaState.interactionPulseRandomness = 0;
    installSeigaihaBackground();
    stopInteractionPulseLoop();
    return;
  }

  seigaihaState.interactionPulseRaf = requestAnimationFrame(tickInteractionPulse);
}

export function pulseSeigaihaRandomness(options?: {
  minRandomness?: number;
  maxRandomness?: number;
  durationMs?: number;
}): void {
  const rawMin = options?.minRandomness ?? BUTTON_PULSE_MIN_RANDOMNESS;
  const rawMax = options?.maxRandomness ?? BUTTON_PULSE_MAX_RANDOMNESS;
  const minRandomness = clamp(Math.min(rawMin, rawMax), 0, 1);
  const maxRandomness = clamp(Math.max(rawMin, rawMax), minRandomness, 1);
  const durationMs = clamp(options?.durationMs ?? BUTTON_PULSE_DURATION_MS, 1, 6000);
  const range = Math.max(0, maxRandomness - minRandomness);
  const peak = minRandomness + Math.random() * range;

  seigaihaState.interactionPulsePeak = peak;
  seigaihaState.interactionPulseRandomness = peak;
  seigaihaState.interactionPulseDurationMs = durationMs;
  seigaihaState.interactionPulseStartAtMs = performance.now();
  installSeigaihaBackground();

  if (typeof window === "undefined") {
    return;
  }
  stopInteractionPulseLoop();
  seigaihaState.interactionPulseRaf = requestAnimationFrame(tickInteractionPulse);
}

function stopNoNoteDecayLoop(): void {
  if (seigaihaState.noNoteDecayRaf !== null) {
    cancelAnimationFrame(seigaihaState.noNoteDecayRaf);
    seigaihaState.noNoteDecayRaf = null;
  }
}

function stopTunerSmoothingLoop(): void {
  if (seigaihaState.tunerSmoothingRaf !== null) {
    cancelAnimationFrame(seigaihaState.tunerSmoothingRaf);
    seigaihaState.tunerSmoothingRaf = null;
  }
  seigaihaState.tunerSmoothingLastAtMs = 0;
}

function tickTunerSmoothing(now: number): void {
  if (seigaihaState.debugOverrideEnabled || seigaihaState.modeRandomness !== null) {
    stopTunerSmoothingLoop();
    return;
  }
  const target = seigaihaState.tunerTargetRandomness;
  if (target === null) {
    stopTunerSmoothingLoop();
    return;
  }

  const last = seigaihaState.tunerSmoothingLastAtMs || now;
  const dtMs = Math.max(0, now - last);
  seigaihaState.tunerSmoothingLastAtMs = now;
  const alpha =
    1 - Math.exp(-dtMs / Math.max(16, seigaihaState.tunerSmoothingTimeConstantMs));
  const next =
    seigaihaState.randomness + (target - seigaihaState.randomness) * clamp(alpha, 0, 1);
  applyRandomness(next);

  if (Math.abs(target - seigaihaState.randomness) <= 0.0008) {
    applyRandomness(target);
    stopTunerSmoothingLoop();
    return;
  }

  seigaihaState.tunerSmoothingRaf = requestAnimationFrame(tickTunerSmoothing);
}

function startTunerSmoothingLoop(): void {
  if (seigaihaState.tunerSmoothingRaf !== null) return;
  seigaihaState.tunerSmoothingLastAtMs = 0;
  seigaihaState.tunerSmoothingRaf = requestAnimationFrame(tickTunerSmoothing);
}

function tickNoNoteDecay(now: number): void {
  if (seigaihaState.debugOverrideEnabled) {
    seigaihaState.noNoteDecayStartAt = null;
    stopNoNoteDecayLoop();
    return;
  }

  const startAt = seigaihaState.noNoteDecayStartAt;
  if (startAt === null) {
    stopNoNoteDecayLoop();
    return;
  }

  const t = clamp((now - startAt) / NO_NOTE_DECAY_MS, 0, 1);
  applyRandomness(seigaihaState.noNoteDecayStartRandomness * (1 - t));

  if (t >= 1) {
    seigaihaState.noNoteDecayStartAt = null;
    stopNoNoteDecayLoop();
    return;
  }

  seigaihaState.noNoteDecayRaf = requestAnimationFrame(tickNoNoteDecay);
}

function startNoNoteDecayLoop(): void {
  if (seigaihaState.noNoteDecayRaf !== null) return;
  seigaihaState.noNoteDecayRaf = requestAnimationFrame(tickNoNoteDecay);
}

function applyModeDrivenRandomness(): void {
  const driver = resolveSeigaihaRandomnessDriver({
    debugOverrideEnabled: seigaihaState.debugOverrideEnabled,
    modeRandomness: seigaihaState.modeRandomness,
    lastDetuneAbsCents: seigaihaState.lastDetuneAbsCents,
  });

  if (driver === "debug") {
    stopTunerSmoothingLoop();
    applyRandomness(seigaihaState.debugOverrideRandomness);
    return;
  }
  if (driver === "mode") {
    stopTunerSmoothingLoop();
    applyRandomness(seigaihaState.modeRandomness ?? 0);
    return;
  }
  if (driver === "none") {
    stopTunerSmoothingLoop();
    return;
  }
  const mapped = mapSeigaihaDetuneToRandomness(seigaihaState.lastDetuneAbsCents ?? 0);
  seigaihaState.tunerTargetRandomness = mapped;
  startTunerSmoothingLoop();
}

export function resolveSeigaihaRandomnessDriver(options: {
  debugOverrideEnabled: boolean;
  modeRandomness: number | null;
  lastDetuneAbsCents: number | null;
}): SeigaihaRandomnessDriver {
  if (options.debugOverrideEnabled) return "debug";
  if (options.modeRandomness !== null) return "mode";
  if (options.lastDetuneAbsCents !== null) return "tuner";
  return "none";
}

export function installSeigaihaBackground(): void {
  const renderer = ensureRenderer();
  if (!renderer || renderer.backend === "none") {
    return;
  }
  const frame = resolveInterpolatedFrames(getEffectiveRandomness());
  const now = performance.now();
  const hasPatternSwap =
    seigaihaState.installedPatternKeyA !== frame.keyA ||
    seigaihaState.installedPatternKeyB !== frame.keyB;
  const hasBlendSwap =
    Math.abs(seigaihaState.installedBlendA - frame.blendA) > 0.0005 ||
    Math.abs(seigaihaState.installedBlendB - frame.blendB) > 0.0005;

  if (!hasPatternSwap && !hasBlendSwap) {
    return;
  }

  const primary = getOrCreateCachedPattern(frame.keyA);
  const secondary = frame.keyB === frame.keyA ? primary : getOrCreateCachedPattern(frame.keyB);
  uploadPatternTextureWhenReady(primary, renderer);
  if (secondary !== primary) {
    uploadPatternTextureWhenReady(secondary, renderer);
  }
  if (hasPatternSwap) {
    prewarmPatternNeighborhood(frame);
  }

  if (!primary.texture || !secondary.texture || !primary.textureReady || !secondary.textureReady) {
    return;
  }

  renderer.render({
    textureA: primary.texture,
    textureB: secondary.texture,
    blendA: frame.blendA,
    blendB: frame.blendB,
    tileWidth: primary.tileWidth,
    tileHeight: primary.tileHeight,
  });
  recordRenderDraw(now);
  if (typeof document !== "undefined") {
    document.body.setAttribute("data-seigaiha-render-ready", "1");
  }

  seigaihaState.installedPatternKeyA = frame.keyA;
  seigaihaState.installedPatternKeyB = frame.keyB;
  seigaihaState.installedBlendA = frame.blendA;
  seigaihaState.installedBlendB = frame.blendB;
  if (hasPatternSwap) {
    seigaihaState.renderCount += 1;
    recordRenderSwap(now);
  }
  seigaihaState.lastRenderAtMs = now;
}

export function setSeigaihaRandomness(value: number): void {
  seigaihaState.debugOverrideRandomness = clamp(value, 0, 1);
  if (seigaihaState.debugOverrideEnabled) {
    applyRandomness(seigaihaState.debugOverrideRandomness);
  }
}

export function getSeigaihaRandomness(): number {
  return getEffectiveRandomness();
}

export function getSeigaihaRendererBackend(): SeigaihaRendererBackend {
  ensureRenderer();
  return seigaihaState.rendererBackend;
}

export function getSeigaihaPerformanceStats(): SeigaihaPerformanceStats {
  const count = seigaihaState.frameTimesCount;
  const samples = seigaihaState.frameTimesMs.slice(0, count);
  let avgFrameMs = 0;
  let maxFrameMs = 0;
  if (samples.length > 0) {
    const sum = samples.reduce((acc, value) => acc + value, 0);
    avgFrameMs = sum / samples.length;
    maxFrameMs = samples.reduce((max, value) => Math.max(max, value), 0);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p95Index =
    sorted.length > 0 ? Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95)) : 0;
  const p95FrameTimeMs = sorted.length > 0 ? sorted[p95Index] ?? 0 : 0;
  const now = performance.now();
  const recentSwaps = countRecentEvents(seigaihaState.renderSwapAtMs, now);
  const recentDraws = countRecentEvents(seigaihaState.renderDrawAtMs, now);
  const recentUploads = countRecentEvents(seigaihaState.textureUploadAtMs, now);
  const renderSwapsPerSec = (recentSwaps * 1000) / SWAP_SAMPLE_WINDOW_MS;
  const renderDrawsPerSec = (recentDraws * 1000) / SWAP_SAMPLE_WINDOW_MS;
  const textureUploadsPerSec = (recentUploads * 1000) / SWAP_SAMPLE_WINDOW_MS;
  const cacheHitRate =
    seigaihaState.cacheLookups > 0
      ? seigaihaState.cacheHits / seigaihaState.cacheLookups
      : 0;
  return {
    avgFps: avgFrameMs > 0 ? 1000 / avgFrameMs : 0,
    p95FrameTimeMs,
    maxFrameTimeMs: maxFrameMs,
    renderSwapsPerSec,
    renderDrawsPerSec,
    textureUploadsPerSec,
    cacheLookups: seigaihaState.cacheLookups,
    cacheHits: seigaihaState.cacheHits,
    cacheMisses: seigaihaState.cacheMisses,
    cacheHitRate,
    cacheSize: seigaihaState.patternCache.size,
    cacheMaxEntries: RANDOMNESS_CACHE_MAX_ENTRIES,
    sampleCount: samples.length,
  };
}

export function setSeigaihaTunerSmoothingTimeConstantMs(value: number): void {
  if (!Number.isFinite(value)) return;
  seigaihaState.tunerSmoothingTimeConstantMs = clamp(value, 16, 1000);
}

export function getSeigaihaTunerSmoothingTimeConstantMs(): number {
  return seigaihaState.tunerSmoothingTimeConstantMs;
}

export function setSeigaihaDetuneMapping(points: SeigaihaMappingPoint[]): void {
  seigaihaState.mapping = normalizeMapping(points);
  applyModeDrivenRandomness();
}

export function getSeigaihaDetuneMapping(): SeigaihaMappingPoint[] {
  return seigaihaState.mapping.map((point) => ({ ...point }));
}

export function setSeigaihaDebugOverrideEnabled(enabled: boolean): void {
  seigaihaState.debugOverrideEnabled = enabled;
  if (enabled) {
    seigaihaState.tunerTargetRandomness = null;
    stopTunerSmoothingLoop();
    seigaihaState.noNoteDecayStartAt = null;
    stopNoNoteDecayLoop();
    applyRandomness(seigaihaState.debugOverrideRandomness);
    return;
  }
  if (seigaihaState.lastDetuneAbsCents === null) {
    if (seigaihaState.randomness <= 0.0005) {
      applyRandomness(0);
      return;
    }
    seigaihaState.noNoteDecayStartAt = performance.now();
    seigaihaState.noNoteDecayStartRandomness = seigaihaState.randomness;
    startNoNoteDecayLoop();
    return;
  }
  applyModeDrivenRandomness();
}

export function isSeigaihaDebugOverrideEnabled(): boolean {
  return seigaihaState.debugOverrideEnabled;
}

export function setSeigaihaDetuneMagnitude(absCents: number | null): void {
  if (seigaihaState.debugOverrideEnabled) {
    return;
  }
  if (seigaihaState.modeRandomness !== null) {
    return;
  }

  if (absCents === null || !Number.isFinite(absCents)) {
    seigaihaState.lastDetuneAbsCents = null;
    seigaihaState.tunerTargetRandomness = null;
    stopTunerSmoothingLoop();
    if (seigaihaState.noNoteDecayStartAt === null) {
      if (seigaihaState.randomness <= 0.0005) {
        applyRandomness(0);
        return;
      }
      seigaihaState.noNoteDecayStartAt = performance.now();
      seigaihaState.noNoteDecayStartRandomness = seigaihaState.randomness;
      startNoNoteDecayLoop();
    }
    return;
  }

  seigaihaState.lastDetuneAbsCents = Math.max(0, absCents);
  seigaihaState.noNoteDecayStartAt = null;
  stopNoNoteDecayLoop();
  seigaihaState.tunerTargetRandomness = mapSeigaihaDetuneToRandomness(
    seigaihaState.lastDetuneAbsCents
  );
  startTunerSmoothingLoop();
}

export function setSeigaihaModeRandomness(value: number | null): void {
  seigaihaState.modeRandomness =
    value === null || !Number.isFinite(value) ? null : clamp(value, 0, 1);
  if (seigaihaState.modeRandomness !== null) {
    seigaihaState.tunerTargetRandomness = null;
    stopTunerSmoothingLoop();
    seigaihaState.noNoteDecayStartAt = null;
    stopNoNoteDecayLoop();
  } else if (seigaihaState.lastDetuneAbsCents !== null) {
    seigaihaState.tunerTargetRandomness = mapSeigaihaDetuneToRandomness(
      seigaihaState.lastDetuneAbsCents
    );
    startTunerSmoothingLoop();
  }
  applyModeDrivenRandomness();
}
