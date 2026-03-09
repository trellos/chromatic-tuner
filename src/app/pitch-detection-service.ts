// Pitch detection service: mic acquisition, AudioWorklet loading, audio graph
// construction, and test-tone support.
// Extracted from tuner.ts to be reusable across modes.
import { createAudioContextService } from "./audio-context-service.js";

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

export function createPitchDetectionService(): PitchDetectionService {
  const audioCtxService = createAudioContextService();
  const { isIOS } = audioCtxService;

  let audioContext: AudioContext | null = null;
  let micStream: MediaStream | null = null;
  let workletNode: AudioWorkletNode | null = null;
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
        const freqHz: number | null = data.freqHz ?? null;
        const confidence: number = Number(data.confidence ?? 0);
        const rms: number = Number(data.rms ?? 0);
        const tau: number | null = Number.isFinite(data.tau) ? Number(data.tau) : null;
        const cmnd: number | null = Number.isFinite(data.cmnd) ? Number(data.cmnd) : null;
        const effSr: number | null = Number.isFinite(data.effSr) ? Number(data.effSr) : null;
        const zcHz: number | null = Number.isFinite(data.zcHz) ? Number(data.zcHz) : null;

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
