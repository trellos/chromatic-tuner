var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/audio/worklet.ts
var require_worklet = __commonJS({
  "src/audio/worklet.ts"() {
    var TunerProcessor = class extends AudioWorkletProcessor {
      constructor() {
        super();
        __publicField(this, "ring");
        __publicField(this, "writeIndex", 0);
        // analysis cadence
        __publicField(this, "hopFrames");
        __publicField(this, "framesUntilAnalysis");
        // scratch buffers (allocated once to avoid GC)
        __publicField(this, "analysisBuf");
        __publicField(this, "yinDiff");
        __publicField(this, "yinCMND");
        const bufferSize = 16384;
        this.ring = new Float32Array(bufferSize);
        this.hopFrames = Math.floor(sampleRate / 20);
        this.framesUntilAnalysis = this.hopFrames;
        const windowSize = 4096;
        this.analysisBuf = new Float32Array(windowSize);
        const maxTau = Math.floor(windowSize / 2);
        this.yinDiff = new Float32Array(maxTau);
        this.yinCMND = new Float32Array(maxTau);
        this.port.postMessage({
          type: "worklet-ready",
          sampleRate,
          bufferSize: this.ring.length
        });
      }
      pushBlock(input) {
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
      copyLatestWindow(dest) {
        const buf = this.ring;
        const len = buf.length;
        const n = dest.length;
        let idx = (this.writeIndex - n + len) % len;
        for (let i = 0; i < n; i++) {
          dest[i] = buf[idx];
          idx = (idx + 1) % len;
        }
      }
      computeRms(x) {
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
      yinDetect(x, sampleRate2, diff, cmnd) {
        const n = x.length;
        const maxTau = diff.length;
        diff.fill(0);
        for (let tau2 = 1; tau2 < maxTau; tau2++) {
          let sum = 0;
          for (let i = 0; i < n - tau2; i++) {
            const d = x[i] - x[i + tau2];
            sum += d * d;
          }
          diff[tau2] = sum;
        }
        cmnd[0] = 1;
        let runningSum = 0;
        for (let tau2 = 1; tau2 < maxTau; tau2++) {
          runningSum += diff[tau2];
          cmnd[tau2] = runningSum > 0 ? diff[tau2] * tau2 / runningSum : 1;
        }
        const threshold = 0.15;
        let tauEstimate = -1;
        for (let tau2 = 2; tau2 < maxTau; tau2++) {
          if (cmnd[tau2] < threshold) {
            while (tau2 + 1 < maxTau && cmnd[tau2 + 1] < cmnd[tau2]) {
              tau2++;
            }
            tauEstimate = tau2;
            break;
          }
        }
        if (tauEstimate === -1) {
          let minVal = 1e9;
          let minTau = -1;
          for (let tau2 = 2; tau2 < maxTau; tau2++) {
            const v = cmnd[tau2];
            if (v < minVal) {
              minVal = v;
              minTau = tau2;
            }
          }
          tauEstimate = minTau;
          if (tauEstimate <= 0) return { freqHz: null, confidence: 0 };
        }
        const tau = tauEstimate;
        const x0 = tau > 1 ? cmnd[tau - 1] : cmnd[tau];
        const x1 = cmnd[tau];
        const x2 = tau + 1 < maxTau ? cmnd[tau + 1] : cmnd[tau];
        const denom = 2 * x1 - x2 - x0;
        const betterTau = denom !== 0 ? tau + (x2 - x0) / (2 * denom) : tau;
        const freqHz = betterTau > 0 ? sampleRate2 / betterTau : null;
        const rawConf = 1 - x1;
        const confidence = Math.max(0, Math.min(1, rawConf));
        if (freqHz === null || freqHz < 60 || freqHz > 1200) {
          return { freqHz: null, confidence: 0 };
        }
        return { freqHz, confidence };
      }
      process(inputs) {
        const input = inputs[0]?.[0];
        if (input && input.length > 0) {
          this.pushBlock(input);
          this.framesUntilAnalysis -= input.length;
          if (this.framesUntilAnalysis <= 0) {
            this.framesUntilAnalysis += this.hopFrames;
            this.copyLatestWindow(this.analysisBuf);
            const rms = this.computeRms(this.analysisBuf);
            if (rms < 2e-3) {
              this.port.postMessage({
                type: "pitch",
                freqHz: null,
                confidence: 0,
                rms
              });
              return true;
            }
            const { freqHz, confidence } = this.yinDetect(
              this.analysisBuf,
              sampleRate,
              this.yinDiff,
              this.yinCMND
            );
            let f = freqHz;
            let c = confidence;
            if (f !== null) {
              if (f > 120 && f < 400) {
                const half = f / 2;
                if (half >= 60) {
                  if (c < 0.75) {
                    f = half;
                    c = Math.max(0, c - 0.05);
                  }
                }
              }
            }
            const ok = f !== null && confidence > 0.75;
            this.port.postMessage({
              type: "pitch",
              freqHz: ok ? f : null,
              confidence: c,
              rms
            });
          }
        }
        return true;
      }
    };
    registerProcessor("tuner", TunerProcessor);
  }
});
export default require_worklet();
//# sourceMappingURL=worklet.js.map
