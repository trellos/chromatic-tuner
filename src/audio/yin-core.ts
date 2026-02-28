// Core YIN-based pitch detection. Pure function, no side effects.
// Shared between the main-thread iOS ScriptProcessor fallback and any future callers.
// The AudioWorklet copy in worklet.ts is intentionally kept separate due to worklet scope constraints.
export function yinDetectMain(
  x: Float32Array,
  sr: number,
  diff: Float32Array,
  cmnd: Float32Array,
  window: Float32Array
): { freqHz: number | null; confidence: number; tau: number; cmnd: number } {
  const n = x.length;
  const maxTau = diff.length;
  if (n < 4 || maxTau < 4) return { freqHz: null, confidence: 0, tau: 0, cmnd: 1 };

  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i] ?? 0;
  mean /= n;

  diff.fill(0);
  for (let tau = 1; tau < maxTau; tau++) {
    let sum = 0;
    const limit = n - tau;
    for (let i = 0; i < limit; i++) {
      const a = ((x[i] ?? 0) - mean) * (window[i] ?? 1);
      const b = ((x[i + tau] ?? 0) - mean) * (window[i + tau] ?? 1);
      const d = a - b;
      sum += d * d;
    }
    diff[tau] = sum;
  }

  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < maxTau; tau++) {
    runningSum += diff[tau] ?? 0;
    const v = diff[tau] ?? 0;
    cmnd[tau] = runningSum > 0 ? (v * tau) / runningSum : 1;
  }

  const threshold = 0.2;
  const tauMin = Math.max(2, Math.floor(sr / 1200));
  const tauMax = Math.min(maxTau - 1, Math.floor(sr / 70));
  let tauEstimate = -1;
  let bestVal = Number.POSITIVE_INFINITY;

  for (let tau = tauMin + 1; tau < tauMax; tau++) {
    const prev = cmnd[tau - 1] ?? 1;
    const cur = cmnd[tau] ?? 1;
    const next = cmnd[tau + 1] ?? 1;
    if (cur <= prev && cur <= next && cur < bestVal) {
      bestVal = cur;
      tauEstimate = tau;
    }
  }

  if (tauEstimate === -1) {
    let minVal = Number.POSITIVE_INFINITY;
    let minTau = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      const v = cmnd[tau] ?? 1;
      if (v < minVal) {
        minVal = v;
        minTau = tau;
      }
    }
    tauEstimate = minTau;
    bestVal = minVal;
    if (tauEstimate <= 0) return { freqHz: null, confidence: 0, tau: 0, cmnd: 1 };
  }

  if (bestVal > threshold) {
    return { freqHz: null, confidence: 0, tau: 0, cmnd: bestVal };
  }

  let bestTau = tauEstimate;
  let bestScore = cmnd[bestTau] ?? 1;
  const candidates = [
    tauEstimate / 2,
    tauEstimate / 3,
    tauEstimate * 2,
    tauEstimate * 3,
  ];

  for (const raw of candidates) {
    const candidate = Math.round(raw);
    if (candidate - 1 < tauMin || candidate + 1 > tauMax) continue;
    const ratio = Math.abs(Math.log2(candidate / tauEstimate));
    const penalty = 0.04 * ratio;
    const candVal = cmnd[candidate] ?? 1;
    const score = candVal + penalty;
    if (score < bestScore) {
      bestScore = score;
      bestTau = candidate;
    }
  }

  const t = Math.max(2, Math.min(bestTau, maxTau - 2));
  const x0 = cmnd[t - 1] ?? 1;
  const x1 = cmnd[t] ?? 1;
  const x2 = cmnd[t + 1] ?? 1;

  const denom = 2 * x1 - x2 - x0;
  const betterTau = denom !== 0 ? t + (x2 - x0) / (2 * denom) : t;
  const freqHz = betterTau > 0 ? sr / betterTau : null;
  const confidence = Math.max(0, Math.min(1, 1 - x1));

  if (freqHz === null || freqHz < 60 || freqHz > 1200) {
    return { freqHz: null, confidence: 0, tau: 0, cmnd: 1 };
  }

  return { freqHz, confidence, tau: betterTau, cmnd: x1 };
}
