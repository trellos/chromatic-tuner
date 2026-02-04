/// <reference lib="webworker" />

type WorkletMessage =
  | { type: "worklet-ready"; sampleRate: number; bufferSize: number }
  | { type: "pitch"; freqHz: number | null; confidence: number; rms: number };

class TunerProcessor extends AudioWorkletProcessor {
  private ring: Float32Array;
  private writeIndex = 0;

  // analysis cadence
  private hopFrames: number;
  private framesUntilAnalysis: number;

  // scratch buffers (allocated once to avoid GC)
  private analysisBuf: Float32Array;
  private yinDiff: Float32Array;
  private yinCMND: Float32Array;

  constructor() {
    super();

    const bufferSize = 16384;
    this.ring = new Float32Array(bufferSize);

    // Analysis ~30Hz is a good starting point for responsiveness. Moved to 20.
    this.hopFrames = Math.floor(sampleRate / 20);
    this.framesUntilAnalysis = this.hopFrames;

    // Window size: tradeoff between low-note support and latency.
    // 2048 @ 48kHz ≈ 42.7ms, supports down to ~100Hz-ish with some stability.
    // Increase later if you care about E2 (82Hz) stability.
    const windowSize = 4096;
    this.analysisBuf = new Float32Array(windowSize);

    // YIN uses tau up to windowSize/2
    const maxTau = Math.floor(windowSize / 2);
    this.yinDiff = new Float32Array(maxTau);
    this.yinCMND = new Float32Array(maxTau);

    this.port.postMessage({
      type: "worklet-ready",
      sampleRate,
      bufferSize: this.ring.length,
    } satisfies WorkletMessage);
  }

  private pushBlock(input: Float32Array) {
    const n = input.length;
    const buf = this.ring;
    const len = buf.length;

    let i = 0;
    while (i < n) {
      const spaceToEnd = len - this.writeIndex;
      const chunk = Math.min(spaceToEnd, n - i);
      buf.set(input.subarray(i, i + chunk), this.writeIndex);
      this.writeIndex = (this.writeIndex + chunk) % len;
      i += chunk;
    }
  }

  private copyLatestWindow(dest: Float32Array) {
    const buf = this.ring;
    const len = buf.length;
    const n = dest.length;

    // dest[0] is oldest, dest[n-1] is newest
    let idx = (this.writeIndex - n + len) % len;
    for (let i = 0; i < n; i++) {
      dest[i] = buf[idx];
      idx = (idx + 1) % len;
    }
  }

  private computeRms(x: Float32Array): number {
    let sumSq = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      sumSq += v * v;
    }
    return Math.sqrt(sumSq / x.length);
  }

  /**
   * YIN pitch detection.
   * Returns {freqHz, confidence}. freqHz null if no good pitch.
   *
   * confidence is ~ 1 - (bestCMND), so higher is better.
   */
  private yinDetect(
    x: Float32Array,
    sampleRate: number,
    diff: Float32Array,
    cmnd: Float32Array
  ): { freqHz: number | null; confidence: number } {
    const n = x.length;
    const maxTau = diff.length;

    // 1) Difference function d(tau)
    diff.fill(0);
    for (let tau = 1; tau < maxTau; tau++) {
      let sum = 0;
      for (let i = 0; i < n - tau; i++) {
        const d = x[i] - x[i + tau];
        sum += d * d;
      }
      diff[tau] = sum;
    }

    // 2) Cumulative mean normalized difference function (CMND)
    cmnd[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau < maxTau; tau++) {
      runningSum += diff[tau];
      cmnd[tau] = runningSum > 0 ? (diff[tau] * tau) / runningSum : 1;
    }

    // 3) Find first dip below threshold
    const threshold = 0.15; // lower => stricter; 0.10-0.20 typical
    let tauEstimate = -1;

    for (let tau = 2; tau < maxTau; tau++) {
      if (cmnd[tau] < threshold) {
        // walk to local minimum
        while (tau + 1 < maxTau && cmnd[tau + 1] < cmnd[tau]) {
          tau++;
        }
        tauEstimate = tau;
        break;
      }
    }

    if (tauEstimate === -1) {
      // fallback: global minimum (can be noisy, but better than nothing)
      let minVal = 1e9;
      let minTau = -1;
      for (let tau = 2; tau < maxTau; tau++) {
        const v = cmnd[tau];
        if (v < minVal) {
          minVal = v;
          minTau = tau;
        }
      }
      tauEstimate = minTau;
      if (tauEstimate <= 0) return { freqHz: null, confidence: 0 };
    }

    // 4) Parabolic interpolation around tauEstimate for better accuracy
    const tau = tauEstimate;
    const x0 = tau > 1 ? cmnd[tau - 1] : cmnd[tau];
    const x1 = cmnd[tau];
    const x2 = tau + 1 < maxTau ? cmnd[tau + 1] : cmnd[tau];

    const denom = (2 * x1 - x2 - x0);
    const betterTau =
      denom !== 0 ? tau + (x2 - x0) / (2 * denom) : tau;

    const freqHz = betterTau > 0 ? sampleRate / betterTau : null;

    // Confidence: invert CMND at the selected tau (clamp 0..1)
    const rawConf = 1 - x1;
    const confidence = Math.max(0, Math.min(1, rawConf));

    // Clamp frequency to a sane range for a tuner
    if (freqHz === null || freqHz < 60 || freqHz > 1200) {
      return { freqHz: null, confidence: 0 };
    }

    return { freqHz, confidence };
  }

  process(inputs: Float32Array[][]) {
    const input = inputs[0]?.[0];
    if (input && input.length > 0) {
      this.pushBlock(input);

      this.framesUntilAnalysis -= input.length;
      if (this.framesUntilAnalysis <= 0) {
        this.framesUntilAnalysis += this.hopFrames;

        // Pull latest window
        this.copyLatestWindow(this.analysisBuf);

        // Basic silence gate
        const rms = this.computeRms(this.analysisBuf);
        if (rms < 0.002) {
          this.port.postMessage({
            type: "pitch",
            freqHz: null,
            confidence: 0,
            rms,
          } satisfies WorkletMessage);
          return true;
        }

        const { freqHz, confidence } = this.yinDetect(
          this.analysisBuf,
          sampleRate,
          this.yinDiff,
          this.yinCMND
        );

        // Hysteresis on octave
        let f = freqHz;
        let c = confidence;

        // If we got a pitch but it's unstable, try octave correction:
        // If we're near E3 but the signal is likely an E2 fundamental,
        // checking f/2 often stabilizes.
        if (f !== null) {
            // Only attempt correction in guitar-ish low range where octave errors are common
            if (f > 120 && f < 400) {
                const half = f / 2;
                // Treat half frequency as candidate if it's still in range
                if (half >= 60) {
                    // Compute how well half fits by checking cents proximity to nearest MIDI note
                    // We can’t do full note mapping in worklet cheaply, but we can use a ratio test:
                    // If f is close to 2x of a stable fundamental, half will often be more stable over time.
                    // Heuristic: prefer half if confidence is mediocre (harmonic lock) and RMS is decent.
                    if (c < 0.75) {
                        f = half;
                        // reduce confidence slightly (it’s a heuristic)
                        c = Math.max(0, c - 0.05);
                    }
                }
            }
        }

        // Gate on confidence too
        const ok = f !== null && confidence > 0.75;

        this.port.postMessage({
          type: "pitch",
          freqHz: ok ? f : null,
          confidence: c,
          rms,
        } satisfies WorkletMessage);
      }
    }

    return true;
  }
}

registerProcessor("tuner", TunerProcessor);
