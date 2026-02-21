function svgToDataUrl(svg: string): string {
  const encoded = encodeURIComponent(svg)
    .replace(/%0A/g, "")
    .replace(/%09/g, "")
    .replace(/%20/g, " ");
  return `url("data:image/svg+xml,${encoded}")`;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

export function quantizeSeigaihaRandomnessForCache(value: number): number {
  return quantizeRandomness(value);
}

type SeigaihaState = {
  randomness: number;
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
  renderCount: number;
  lastRenderAtMs: number;
  tunerTargetRandomness: number | null;
  tunerSmoothingRaf: number | null;
  tunerSmoothingLastAtMs: number;
  tunerSmoothingTimeConstantMs: number;
};

export type SeigaihaMappingPoint = {
  cents: number;
  randomness: number;
};

type CachedPattern = {
  dataUrl: string;
  tileWidth: number;
  tileHeight: number;
};

export type SeigaihaRenderStats = {
  renderCount: number;
  lastRenderAtMs: number;
};

export type SeigaihaRandomnessDriver = "debug" | "mode" | "tuner" | "none";

const NO_NOTE_DECAY_MS = 1000;
const DEFAULT_TUNER_SMOOTHING_TIME_CONSTANT_MS = 220;
const RANDOMNESS_CACHE_STEP = 1 / 480;
const RANDOMNESS_CACHE_MAX_ENTRIES = 640;
const DEFAULT_MAPPING: SeigaihaMappingPoint[] = [
  { cents: 2, randomness: 0 },
  { cents: 4, randomness: 0.2 },
  { cents: 10, randomness: 0.5 },
];

const seigaihaState: SeigaihaState = {
  randomness: 0,
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
  renderCount: 0,
  lastRenderAtMs: 0,
  tunerTargetRandomness: null,
  tunerSmoothingRaf: null,
  tunerSmoothingLastAtMs: 0,
  tunerSmoothingTimeConstantMs: DEFAULT_TUNER_SMOOTHING_TIME_CONSTANT_MS,
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
      const pairShrink = (shrinkByCol[col] + shrinkByCol[nextCol]) * 0.5;
      edgeCompaction[col] = clamp(stepX * (0.72 * pairShrink), 0, maxNeighborPull);
      localStepByCol[col] = stepX - edgeCompaction[col];
    }

    const rawPeriodWidth = localStepByCol.reduce((sum, value) => sum + value, 0);
    const widthCorrection = (tileWidth - rawPeriodWidth) / colPeriod;
    for (let col = 0; col < colPeriod; col++) {
      localStepByCol[col] += widthCorrection;
    }

    let cursorX = 0;
    for (let col = 0; col < colPeriod; col++) {
      centerByCol[col] = cursorX;
      cursorX += localStepByCol[col];
    }

    const waves: Array<{ cx: number; radius: number; col: number }> = [];
    for (let cycle = cycleMin; cycle <= cycleMax; cycle++) {
      for (let col = 0; col < colPeriod; col++) {
        const cx = centerByCol[col] + cycle * tileWidth + xOffset;
        const waveR = radiusByCol[col];
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
        const [kOuter, kInner] = blueBands[bandIndex];
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

function setRootVar(name: string, value: string): void {
  document.documentElement.style.setProperty(name, value);
}

function getOrCreateCachedPattern(randomness: number): CachedPattern {
  const key = quantizeRandomness(randomness);
  const existing = seigaihaState.patternCache.get(key);
  if (existing) {
    return existing;
  }

  const { svg, tileWidth, tileHeight } = generateTraditionalSeigaihaSvg({
    radius: 40,
    paperColor: "#315ecf",
    inkColor: "#264eb9",
    accentInkColor: "#7c3aed",
    randomness: key,
    seed: seigaihaState.seed,
  });

  const created: CachedPattern = {
    dataUrl: svgToDataUrl(svg),
    tileWidth,
    tileHeight,
  };
  seigaihaState.patternCache.set(key, created);

  // Basic FIFO eviction to bound memory while keeping recent frames hot.
  if (seigaihaState.patternCache.size > RANDOMNESS_CACHE_MAX_ENTRIES) {
    const oldestKey = seigaihaState.patternCache.keys().next().value;
    if (oldestKey !== undefined) {
      seigaihaState.patternCache.delete(oldestKey);
    }
  }

  return created;
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
  const next = clamp(randomness, 0, 1);
  if (Math.abs(next - seigaihaState.randomness) < 0.0002) {
    return;
  }
  seigaihaState.randomness = next;
  installSeigaihaBackground();
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
  const { dataUrl, tileWidth, tileHeight } = getOrCreateCachedPattern(
    seigaihaState.randomness
  );

  setRootVar("--seigaiha-url", dataUrl);
  setRootVar("--seigaiha-size-x", `${tileWidth}px`);
  setRootVar("--seigaiha-size-y", `${tileHeight}px`);
  setRootVar("--seigaiha-pos", "0px 0px");
  seigaihaState.renderCount += 1;
  seigaihaState.lastRenderAtMs = performance.now();
}

export function setSeigaihaRandomness(value: number): void {
  seigaihaState.debugOverrideRandomness = clamp(value, 0, 1);
  if (seigaihaState.debugOverrideEnabled) {
    applyRandomness(seigaihaState.debugOverrideRandomness);
  }
}

export function getSeigaihaRandomness(): number {
  return seigaihaState.randomness;
}

export function getSeigaihaRenderStats(): SeigaihaRenderStats {
  return {
    renderCount: seigaihaState.renderCount,
    lastRenderAtMs: seigaihaState.lastRenderAtMs,
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
