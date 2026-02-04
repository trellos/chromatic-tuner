/// <reference lib="webworker" />

type WorkletMessage =
  | { type: "worklet-ready"; sampleRate: number; bufferSize: number }
  | { type: "pitch"; freqHz: number | null; confidence: number; rms: number };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

class TunerProcessor extends AudioWorkletProcessor {
  private ring: Float32Array;
  private writeIndex = 0;

  private hopFrames: number;
  private framesUntilAnalysis: number;

  private analysisBuf: Float32Array;
  private yinDiff: Float32Array;
  private yinCMND: Float32Array;

  constructor() {
    super();

    const bufferSize = 16384;
    this.ring = new Float32Array(bufferSize);

    this.hopFrames = Math.floor(sampleRate / 20);
    this.framesUntilAnalysis = this.hopFrames;

    const windowSize = 4096;
    this.analysisBuf = new Float32Array(windowSize);

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
  ): { freqHz: number | null; confidence: number } {
    const n = x.length;
    const maxTau = diff.length; // == cmnd.length

    // Need at least a few taus to do anything
    if (n < 4 || maxTau < 4) return { freqHz: null, confidence: 0 };

    // 1) Difference function d(tau)
    diff.fill(0);
    for (let tau = 1; tau < maxTau; tau++) {
      let sum = 0;
      const limit = n - tau;
      for (let i = 0; i < limit; i++) {
        const a = x[i] ?? 0;
        const b = x[i + tau] ?? 0;
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

    // 3) Find first dip below threshold
    const threshold = 0.15;
    let tauEstimate = -1;

    for (let tau = 2; tau < maxTau; tau++) {
      const v = cmnd[tau] ?? 1;
      if (v < threshold) {
        // walk to local minimum
        while (tau + 1 < maxTau) {
          const cur = cmnd[tau] ?? 1;
          const nxt = cmnd[tau + 1] ?? 1;
          if (nxt < cur) tau++;
          else break;
        }
        tauEstimate = tau;
        break;
      }
    }

    if (tauEstimate === -1) {
      // fallback: global min
      let minVal = Number.POSITIVE_INFINITY;
      let minTau = -1;
      for (let tau = 2; tau < maxTau; tau++) {
        const v = cmnd[tau] ?? 1;
        if (v < minVal) {
          minVal = v;
          minTau = tau;
        }
      }
      tauEstimate = minTau;
      if (tauEstimate <= 0) return { freqHz: null, confidence: 0 };
    }

    // 4) Parabolic interpolation (safe indexing)
    const t = clamp(tauEstimate, 2, maxTau - 2);
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
      return { freqHz: null, confidence: 0 };
    }

    return { freqHz, confidence };
  }

  process(inputs: Float32Array[][]): boolean {
    // Avoid optional chaining on nested arrays under noUncheckedIndexedAccess by
    // explicitly checking lengths.
    if (inputs.length < 1) return true;
    const in0 = inputs[0];
    if (!in0 || in0.length < 1) return true;
    const chan0 = in0[0];
    if (!chan0 || chan0.length === 0) return true;

    this.pushBlock(chan0);

    this.framesUntilAnalysis -= chan0.length;
    if (this.framesUntilAnalysis > 0) return true;
    this.framesUntilAnalysis += this.hopFrames;

    this.copyLatestWindow(this.analysisBuf);

    const rms = this.computeRms(this.analysisBuf);
    if (rms < 0.01) {
      const msg: WorkletMessage = { type: "pitch", freqHz: null, confidence: 0, rms };
      this.port.postMessage(msg);
      return true;
    }

    const { freqHz, confidence } = this.yinDetect(
      this.analysisBuf,
      sampleRate,
      this.yinDiff,
      this.yinCMND
    );

    // Gate on confidence
    const ok = freqHz !== null && confidence > 0.75;

    const msg: WorkletMessage = {
      type: "pitch",
      freqHz: ok ? freqHz : null,
      confidence,
      rms,
    };
    this.port.postMessage(msg);

    return true;
  }
}

registerProcessor("tuner", TunerProcessor);

