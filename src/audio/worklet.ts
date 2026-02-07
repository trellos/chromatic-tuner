/// <reference lib="webworker" />

type WorkletMessage =
  | { type: "worklet-ready"; sampleRate: number; bufferSize: number }
  | {
      type: "pitch";
      freqHz: number | null;
      confidence: number;
      rms: number;
      tau?: number;
      cmnd?: number;
      effSr?: number;
      zcHz?: number;
    };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

class TunerProcessor extends AudioWorkletProcessor {
  private ring: Float32Array;
  private writeIndex = 0;

  private hopFrames: number;
  private framesUntilAnalysis: number;

  private analysisBuf: Float32Array;
  private window: Float32Array;
  private yinDiff: Float32Array;
  private yinCMND: Float32Array;
  private sampleCounter = 0;
  private lastTime = 0;
  private effectiveSampleRate: number | null = null;

  constructor() {
    super();

    const bufferSize = 16384;
    this.ring = new Float32Array(bufferSize);

    this.hopFrames = Math.floor(sampleRate / 20);
    this.framesUntilAnalysis = this.hopFrames;

    const windowSize = 4096;
    this.analysisBuf = new Float32Array(windowSize);
    this.window = new Float32Array(windowSize);
    for (let i = 0; i < windowSize; i++) {
      // Hann window to reduce spectral leakage and DC bias effects.
      this.window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
    }

    const maxTau = Math.floor(windowSize / 2);
    this.yinDiff = new Float32Array(maxTau);
    this.yinCMND = new Float32Array(maxTau);

    const msg: WorkletMessage = {
      type: "worklet-ready",
      sampleRate,
      bufferSize: this.ring.length,
    };
    this.port.postMessage(msg);
  }

  private pushBlock(input: Float32Array): void {
    const n = input.length;
    const buf = this.ring;
    const len = buf.length;

    let i = 0;
    while (i < n) {
      const spaceToEnd = len - this.writeIndex;
      const chunk = Math.min(spaceToEnd, n - i);
      buf.set(input.subarray(i, i + chunk), this.writeIndex);
      this.writeIndex += chunk;
      if (this.writeIndex >= len) this.writeIndex -= len;
      i += chunk;
    }

    // Track effective sample rate (iOS may drop samples).
    this.sampleCounter += n;
    const now = currentTime;
    if (this.lastTime === 0) this.lastTime = now;
    const dt = now - this.lastTime;
    if (dt >= 0.5) {
      const measured = this.sampleCounter / dt;
      if (Number.isFinite(measured) && measured > 1000) {
        const alpha = 0.2;
        this.effectiveSampleRate =
          this.effectiveSampleRate == null
            ? measured
            : this.effectiveSampleRate + alpha * (measured - this.effectiveSampleRate);
      }
      this.sampleCounter = 0;
      this.lastTime = now;
    }
  }

  private copyLatestWindow(dest: Float32Array): void {
    const buf = this.ring;
    const len = buf.length;
    const n = dest.length;

    let idx = this.writeIndex - n;
    while (idx < 0) idx += len;

    for (let i = 0; i < n; i++) {
      // idx is always [0, len)
      dest[i] = buf[idx] ?? 0;
      idx++;
      if (idx >= len) idx = 0;
    }
  }

  private computeRms(x: Float32Array): number {
    let sumSq = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i] ?? 0;
      sumSq += v * v;
    }
    return Math.sqrt(sumSq / x.length);
  }

  private zeroCrossingFreq(x: Float32Array, sr: number): number | null {
    const n = x.length;
    if (n < 2) return null;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += x[i] ?? 0;
    mean /= n;
    let crossings = 0;
    let prev = (x[0] ?? 0) - mean;
    for (let i = 1; i < n; i++) {
      const cur = (x[i] ?? 0) - mean;
      if ((prev <= 0 && cur > 0) || (prev >= 0 && cur < 0)) crossings++;
      prev = cur;
    }
    const seconds = n / sr;
    if (seconds <= 0) return null;
    const freq = (crossings / 2) / seconds;
    return Number.isFinite(freq) ? freq : null;
  }

  /**
   * YIN pitch detection.
   * Returns {freqHz, confidence}. freqHz null if no good pitch.
   *
   * confidence roughly correlates with pitch clarity (0..1).
   */
  private yinDetect(
    x: Float32Array,
    sr: number,
    diff: Float32Array,
    cmnd: Float32Array
  ): { freqHz: number | null; confidence: number; tau: number; cmnd: number } {
    const n = x.length;
    const maxTau = diff.length; // == cmnd.length

    // Need at least a few taus to do anything
    if (n < 4 || maxTau < 4) return { freqHz: null, confidence: 0, tau: 0, cmnd: 1 };

    // 1) Difference function d(tau), with DC removal + Hann window
    let mean = 0;
    for (let i = 0; i < n; i++) mean += x[i] ?? 0;
    mean /= n;

    diff.fill(0);
    for (let tau = 1; tau < maxTau; tau++) {
      let sum = 0;
      const limit = n - tau;
      for (let i = 0; i < limit; i++) {
        const a = ((x[i] ?? 0) - mean) * (this.window[i] ?? 1);
        const b = ((x[i + tau] ?? 0) - mean) * (this.window[i + tau] ?? 1);
        const d = a - b;
        sum += d * d;
      }
      diff[tau] = sum;
    }

    // 2) CMND
    cmnd[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau < maxTau; tau++) {
      runningSum += diff[tau] ?? 0;
      const v = diff[tau] ?? 0;
      cmnd[tau] = runningSum > 0 ? (v * tau) / runningSum : 1;
    }

    // 3) Find best local minimum within a realistic frequency range.
    // This is more stable than "first dip" on resampled/mobile inputs.
    const threshold = 0.2;
    const tauMin = Math.max(2, Math.floor(sr / 1200)); // max freq
    const tauMax = Math.min(maxTau - 1, Math.floor(sr / 70)); // min freq
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
      // fallback: global min in range
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

    // 4) Candidate refinement: consider subharmonics and harmonics with a small penalty.
    // This reduces both sharp bias (too-short tau) and subharmonic picks (too-long tau).
    let bestTau = tauEstimate;
    let bestScore = (cmnd[bestTau] ?? 1);
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

    const t = clamp(bestTau, 2, maxTau - 2);
    const x0 = cmnd[t - 1] ?? 1;
    const x1 = cmnd[t] ?? 1;
    const x2 = cmnd[t + 1] ?? 1;

    const denom = 2 * x1 - x2 - x0;
    const betterTau = denom !== 0 ? t + (x2 - x0) / (2 * denom) : t;

    const freqHz = betterTau > 0 ? sr / betterTau : null;

    // Confidence based on CMND at best tau (clamped)
    const confidence = clamp(1 - x1, 0, 1);

    // Clamp frequency to tuner band
    if (freqHz === null || freqHz < 60 || freqHz > 1200) {
      return { freqHz: null, confidence: 0, tau: 0, cmnd: 1 };
    }

    return { freqHz, confidence, tau: betterTau, cmnd: x1 };
  }

  process(inputs: Float32Array[][]): boolean {
    // Avoid optional chaining on nested arrays under noUncheckedIndexedAccess by
    // explicitly checking lengths.
    if (inputs.length < 1) return true;
    const in0 = inputs[0];
    if (!in0 || in0.length < 1) return true;
    const chan0 = in0[0]; // Mono or left
    if (!chan0 || chan0.length === 0) return true;

    let input = chan0;
    if (in0.length > 1) {
      const chan1 = in0[1]; // Right channel if present
      if (chan1 && chan1.length === chan0.length) {
        const rms0 = this.computeRms(chan0);
        const rms1 = this.computeRms(chan1);
        input = rms1 > rms0 ? chan1 : chan0;
      }
    }

    this.pushBlock(input);

    this.framesUntilAnalysis -= input.length;
    if (this.framesUntilAnalysis > 0) return true;
    this.framesUntilAnalysis += this.hopFrames;

    this.copyLatestWindow(this.analysisBuf);

    const rms = this.computeRms(this.analysisBuf);
    if (rms < 0.002) {
      const msg: WorkletMessage = { type: "pitch", freqHz: null, confidence: 0, rms };
      this.port.postMessage(msg);
      return true;
    }

    const sr = this.effectiveSampleRate ?? sampleRate;
    const { freqHz, confidence, tau, cmnd } = this.yinDetect(
      this.analysisBuf,
      sr,
      this.yinDiff,
      this.yinCMND
    );
    const zcHz = this.zeroCrossingFreq(this.analysisBuf, sr);

    // Gate on confidence
    const ok = freqHz !== null && confidence > 0.5;

    const msg: WorkletMessage = {
      type: "pitch",
      freqHz: ok ? freqHz : null,
      confidence,
      rms,
      tau,
      cmnd,
      ...(this.effectiveSampleRate != null ? { effSr: this.effectiveSampleRate } : {}),
      ...(zcHz != null ? { zcHz } : {}),
    };
    this.port.postMessage(msg);

    return true;
  }
}

registerProcessor("tuner", TunerProcessor);

