// Pitch detection service: mic acquisition, AudioWorklet loading, audio graph
// construction, iOS ScriptProcessor fallback, and test-tone support.
// Extracted from tuner.ts to be reusable across modes.
import { createAudioContextService } from "./audio-context-service.js";
import { yinDetectMain } from "../audio/yin-core.js";

class AudioInteractionRequiredError extends Error {
  constructor(message = "Audio requires a user interaction to start.") {
    super(message);
    this.name = "AudioInteractionRequiredError";
  }
}

export type PitchResult = {
  freqHz: number;
  confidence: number;
  rms: number;
  tau: number | null;
  cmnd: number | null;
  effSr: number | null;
  zcHz: number | null;
  isIOS: boolean;
  scriptPitchHz: number | null;
  scriptWallSr: number | null;
};

export type PitchDetectionListener = {
  onPitch: (result: PitchResult) => void;
  onSilence: (rms: number, confidence: number) => void;
  onStatusChange?: (status: string) => void;
};

export type PitchDetectionService = {
  start(listener: PitchDetectionListener): Promise<void>;
  stop(): void;
  setTestTone(enabled: boolean): void;
  readonly isActive: boolean;
};

function computeRms(x: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] ?? 0;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / x.length);
}

function createHannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

export function createPitchDetectionService(): PitchDetectionService {
  const audioCtxService = createAudioContextService();
  const { isIOS } = audioCtxService;

  let audioContext: AudioContext | null = null;
  let micStream: MediaStream | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let scriptNode: ScriptProcessorNode | null = null;
  let scriptPitchHz: number | null = null;
  let scriptPitchConf = 0;
  let scriptWallSr: number | null = null;
  let useTestTone = false;
  let testOsc: OscillatorNode | null = null;
  let micGainNode: GainNode | null = null;
  let oscGainNode: GainNode | null = null;
  let awaitingAudioUnlock = false;
  let lastAudioMessageAt = 0;
  let active = false;
  let activeListener: PitchDetectionListener | null = null;

  function updateDiagnostics(): void {
    (window as any).__tunerAudioDiagnostics = {
      isIOS,
      awaitingAudioUnlock,
      contextState: audioContext?.state ?? "none",
      hasWorkletNode: workletNode !== null,
      lastAudioMessageAgeMs:
        lastAudioMessageAt === 0
          ? null
          : Math.max(0, Math.round(performance.now() - lastAudioMessageAt)),
    };
  }

  function cleanup(): void {
    active = false;
    activeListener = null;
    if (micStream) {
      for (const track of micStream.getTracks()) track.stop();
      micStream = null;
    }
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close();
    }
    audioContext = null;
    workletNode = null;
    scriptNode = null;
    lastAudioMessageAt = 0;
    awaitingAudioUnlock = false;
    updateDiagnostics();
  }

  // Builds the audio graph and starts receiving pitch messages from the worklet.
  async function startAudio(listener: PitchDetectionListener): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Microphone access not available. On iOS Safari this requires HTTPS (secure context)."
      );
    }

    listener.onStatusChange?.("Requesting microphone permission\u2026");

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });

    listener.onStatusChange?.("Creating AudioContext\u2026");
    const ctx = await audioCtxService.createContext();
    audioContext = ctx;
    await ctx.resume();
    if (ctx.state !== "running") {
      throw new AudioInteractionRequiredError(
        `AudioContext stayed in "${ctx.state}" after resume.`
      );
    }
    updateDiagnostics();

    listener.onStatusChange?.("Loading worklet module\u2026");
    if (!ctx.audioWorklet) {
      throw new Error(
        "AudioWorklet is not supported in this browser. Please use a newer iOS Safari."
      );
    }

    await ctx.audioWorklet.addModule("./assets/worklet.js");

    listener.onStatusChange?.("Creating audio graph\u2026");
    const source = ctx.createMediaStreamSource(micStream);
    workletNode = new AudioWorkletNode(ctx, "tuner");

    const highPass = ctx.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = 70;
    highPass.Q.value = 0.707;

    const lowPass = ctx.createBiquadFilter();
    lowPass.type = "lowpass";
    lowPass.frequency.value = 1200;
    lowPass.Q.value = 0.707;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -30;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.2;

    const gainNode = ctx.createGain();
    gainNode.gain.value = isIOS ? 2.2 : 3;

    const micGain = ctx.createGain();
    micGain.gain.value = 1;
    micGainNode = micGain;

    const oscGain = ctx.createGain();
    oscGain.gain.value = 0;
    oscGainNode = oscGain;

    testOsc = ctx.createOscillator();
    testOsc.type = "sine";
    testOsc.frequency.value = 440;
    testOsc.start();

    source.connect(micGain);
    micGain.connect(highPass);
    testOsc.connect(oscGain);
    oscGain.connect(highPass);
    highPass.connect(lowPass);
    lowPass.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(workletNode);
    workletNode.connect(ctx.destination);

    if (isIOS) {
      // TODO(deprecation): ScriptProcessorNode is deprecated (runs on main thread, may glitch
      // under heavy UI load). Remove once AudioWorklet is confirmed reliable on all supported
      // iOS Safari versions. Track at: https://caniuse.com/audio-worklet
      scriptNode = ctx.createScriptProcessor(2048, 1, 1);
      const windowSize = 4096;
      const ringSize = 16384;
      const ring = new Float32Array(ringSize);
      let writeIndex = 0;
      const analysisBuf = new Float32Array(windowSize);
      const lpBuf = new Float32Array(windowSize);
      const diff = new Float32Array(windowSize / 2);
      const cmnd = new Float32Array(windowSize / 2);
      const diffLp = new Float32Array(windowSize / 2);
      const cmndLp = new Float32Array(windowSize / 2);
      const hannWindow = createHannWindow(windowSize);
      const hopFrames = Math.floor(ctx.sampleRate / 20);
      let framesUntilAnalysis = hopFrames;
      let wallSampleCounter = 0;
      let wallLastTime = performance.now();
      const lpCutoff = 500;
      const lpAlpha =
        (2 * Math.PI * lpCutoff) / (ctx.sampleRate + 2 * Math.PI * lpCutoff);

      const pushBlock = (input: Float32Array) => {
        const n = input.length;
        let i = 0;
        while (i < n) {
          const spaceToEnd = ringSize - writeIndex;
          const chunk = Math.min(spaceToEnd, n - i);
          ring.set(input.subarray(i, i + chunk), writeIndex);
          writeIndex += chunk;
          if (writeIndex >= ringSize) writeIndex -= ringSize;
          i += chunk;
        }
      };

      const copyLatestWindow = (dest: Float32Array) => {
        let idx = writeIndex - dest.length;
        while (idx < 0) idx += ringSize;
        for (let i = 0; i < dest.length; i++) {
          dest[i] = ring[idx] ?? 0;
          idx++;
          if (idx >= ringSize) idx = 0;
        }
      };

      scriptNode.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        if (!input || input.length === 0) return;
        pushBlock(input);
        wallSampleCounter += input.length;
        const nowMs = performance.now();
        const dt = (nowMs - wallLastTime) / 1000;
        if (dt >= 0.2) {
          const measured = wallSampleCounter / dt;
          if (Number.isFinite(measured) && measured > 1000) {
            const alpha = 0.2;
            scriptWallSr =
              scriptWallSr == null
                ? measured
                : scriptWallSr + alpha * (measured - scriptWallSr);
          }
          wallSampleCounter = 0;
          wallLastTime = nowMs;
        }
        framesUntilAnalysis -= input.length;
        if (framesUntilAnalysis > 0) return;
        framesUntilAnalysis += hopFrames;
        copyLatestWindow(analysisBuf);
        const rms = computeRms(analysisBuf);
        if (rms < 0.002) {
          scriptPitchHz = null;
          scriptPitchConf = 0;
          return;
        }

        // Simple low-pass to emphasize fundamentals for acoustic guitar.
        let y = lpBuf[0] ?? 0;
        for (let i = 0; i < analysisBuf.length; i++) {
          const x = analysisBuf[i] ?? 0;
          y = y + lpAlpha * (x - y);
          lpBuf[i] = y;
        }

        const srForAnalysis = scriptWallSr ?? ctx.sampleRate;
        const full = yinDetectMain(analysisBuf, srForAnalysis, diff, cmnd, hannWindow);
        const low = yinDetectMain(lpBuf, srForAnalysis, diffLp, cmndLp, hannWindow);

        // Prefer the low-passed estimate if it is confident and not wildly different.
        let chosen = full;
        if (low.freqHz !== null && low.confidence > 0.6) {
          if (full.freqHz == null || low.confidence >= full.confidence + 0.05) {
            chosen = low;
          } else if (full.freqHz !== null) {
            const ratio = full.freqHz / low.freqHz;
            if (ratio > 1.2 && ratio < 2.2) {
              chosen = low;
            }
          }
        }

        scriptPitchHz = chosen.freqHz;
        scriptPitchConf = chosen.confidence;
      };

      gainNode.connect(scriptNode);
      const spSink = ctx.createGain();
      spSink.gain.value = 0;
      scriptNode.connect(spSink);
      spSink.connect(ctx.destination);
    }

    workletNode.port.onmessage = (ev) => {
      lastAudioMessageAt = performance.now();
      updateDiagnostics();
      const data = ev.data as any;
      const l = activeListener;
      if (!l) return;

      if (data?.type === "worklet-ready") {
        l.onStatusChange?.(
          `Worklet ready. sr=${data.sampleRate}, ring=${data.bufferSize}`
        );
        return;
      }

      if (data?.type === "pitch") {
        let freqHz: number | null = data.freqHz ?? null;
        let confidence: number = Number(data.confidence ?? 0);
        const rms: number = Number(data.rms ?? 0);
        const tau: number | null = Number.isFinite(data.tau) ? Number(data.tau) : null;
        const cmnd: number | null = Number.isFinite(data.cmnd) ? Number(data.cmnd) : null;
        const effSr: number | null = Number.isFinite(data.effSr) ? Number(data.effSr) : null;
        const zcHz: number | null = Number.isFinite(data.zcHz) ? Number(data.zcHz) : null;

        // On iOS, prefer the ScriptProcessor result when it is confident.
        if (isIOS && scriptPitchHz !== null && scriptPitchConf > 0.5) {
          freqHz = scriptPitchHz;
          confidence = scriptPitchConf;
        }

        if (freqHz == null) {
          l.onSilence(rms, confidence);
          return;
        }

        l.onPitch({
          freqHz,
          confidence,
          rms,
          tau,
          cmnd,
          effSr,
          zcHz,
          isIOS,
          scriptPitchHz: isIOS ? scriptPitchHz : null,
          scriptWallSr: isIOS ? scriptWallSr : null,
        });
      }
    };
  }

  // Starts pitch detection, with iOS retry-on-interaction logic.
  async function start(listener: PitchDetectionListener): Promise<void> {
    cleanup();
    active = true;
    activeListener = listener;

    const startWithHandling = async (): Promise<void> => {
      try {
        awaitingAudioUnlock = false;
        updateDiagnostics();
        await startAudio(listener);
      } catch (err) {
        cleanup();

        const needsInteraction =
          err instanceof Error &&
          (err.name === "NotAllowedError" ||
            err.name === "AudioInteractionRequiredError");

        if (isIOS && needsInteraction) {
          active = true;
          activeListener = listener;
          awaitingAudioUnlock = true;
          updateDiagnostics();
          listener.onStatusChange?.("Tap to start audio\u2026");

          const onFirstInteraction = () => {
            document.removeEventListener("click", onFirstInteraction);
            document.removeEventListener("touchend", onFirstInteraction);
            awaitingAudioUnlock = false;
            updateDiagnostics();
            void startWithHandling();
          };
          document.addEventListener("click", onFirstInteraction, { once: true });
          document.addEventListener("touchend", onFirstInteraction, {
            once: true,
            passive: true,
          });
          return;
        }

        let errorMsg = "Error starting audio";
        if (err instanceof Error) {
          if (
            err.name === "NotAllowedError" ||
            err.message.includes("permission")
          ) {
            errorMsg =
              "Microphone permission denied. Please allow microphone access to use the tuner.";
          } else if (
            err.name === "NotFoundError" ||
            err.message.includes("no device")
          ) {
            errorMsg =
              "No microphone found. Please connect a microphone and try again.";
          } else {
            errorMsg = `Error: ${err.message}`;
          }
        }
        listener.onStatusChange?.(errorMsg);
      }
    };

    await startWithHandling();
  }

  function stop(): void {
    cleanup();
  }

  function setTestTone(enabled: boolean): void {
    useTestTone = enabled;
    if (micGainNode && oscGainNode) {
      micGainNode.gain.value = enabled ? 0 : 1;
      oscGainNode.gain.value = enabled ? 1 : 0;
    }
  }

  return {
    start,
    stop,
    setTestTone,
    get isActive() {
      return active;
    },
  };
}
