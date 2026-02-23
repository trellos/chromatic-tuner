const GUITAR_SAMPLE_URL = "assets/audio/fretboard/guitar-acoustic-c4.mp3";
const GUITAR_SAMPLE_BASE_MIDI = 60;

function getAudioContextCtor():
  | (typeof AudioContext)
  | (new (contextOptions?: AudioContextOptions) => AudioContext)
  | null {
  return (
    window.AudioContext ??
    ((window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext ?? null)
  );
}

export type CircleGuitarPlayer = {
  playMidi: (midi: number, durationMs?: number) => Promise<void>;
  playChord: (midis: number[], durationMs?: number) => Promise<void>;
  stopAll: () => void;
  destroy: () => Promise<void>;
};

export function createCircleGuitarPlayer(): CircleGuitarPlayer {
  let audioContext: AudioContext | null = null;
  let sampleBuffer: AudioBuffer | null = null;
  let sampleLoadPromise: Promise<AudioBuffer | null> | null = null;
  const activeSources = new Set<AudioScheduledSourceNode>();

  const ensureAudioContext = async (): Promise<AudioContext | null> => {
    if (audioContext && audioContext.state !== "closed") {
      await audioContext.resume();
      return audioContext;
    }
    const AudioCtx = getAudioContextCtor();
    if (!AudioCtx) return null;
    audioContext = new AudioCtx({ latencyHint: "interactive" });
    await audioContext.resume();
    return audioContext;
  };

  const ensureSample = async (ctx: AudioContext): Promise<AudioBuffer | null> => {
    if (sampleBuffer) return sampleBuffer;
    if (sampleLoadPromise) return sampleLoadPromise;
    sampleLoadPromise = (async () => {
      try {
        const response = await fetch(GUITAR_SAMPLE_URL);
        if (!response.ok) return null;
        const arrayBuffer = await response.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        sampleBuffer = decoded;
        return decoded;
      } catch {
        return null;
      } finally {
        sampleLoadPromise = null;
      }
    })();
    return sampleLoadPromise;
  };

  const registerSource = (source: AudioScheduledSourceNode): void => {
    activeSources.add(source);
    source.addEventListener(
      "ended",
      () => {
        activeSources.delete(source);
      },
      { once: true }
    );
  };

  const playFallbackToneAt = (
    ctx: AudioContext,
    midi: number,
    startTimeSec: number,
    durationMs: number
  ): void => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const freqHz = 440 * Math.pow(2, (midi - 69) / 12);
    const durationSec = Math.max(0.05, durationMs / 1000);
    osc.type = "triangle";
    osc.frequency.value = freqHz;
    gain.gain.setValueAtTime(0.0001, startTimeSec);
    gain.gain.exponentialRampToValueAtTime(0.2, startTimeSec + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTimeSec + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    registerSource(osc);
    osc.start(startTimeSec);
    osc.stop(startTimeSec + durationSec + 0.02);
  };

  const playSampleAt = (
    ctx: AudioContext,
    sample: AudioBuffer,
    midi: number,
    startTimeSec: number,
    durationMs: number
  ): void => {
    const source = ctx.createBufferSource();
    source.buffer = sample;
    source.playbackRate.value = Math.pow(2, (midi - GUITAR_SAMPLE_BASE_MIDI) / 12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.82, startTimeSec);
    source.connect(gain);
    gain.connect(ctx.destination);
    registerSource(source);
    source.start(startTimeSec);
    source.stop(startTimeSec + Math.max(0.05, durationMs / 1000));
  };

  const playMidi = async (midi: number, durationMs = 420): Promise<void> => {
    const ctx = await ensureAudioContext();
    if (!ctx) return;
    const sample = await ensureSample(ctx);
    const at = ctx.currentTime + 0.01;
    if (sample) {
      playSampleAt(ctx, sample, midi, at, durationMs);
      return;
    }
    playFallbackToneAt(ctx, midi, at, durationMs);
  };

  const playChord = async (midis: number[], durationMs = 900): Promise<void> => {
    const ctx = await ensureAudioContext();
    if (!ctx) return;
    const sample = await ensureSample(ctx);
    const at = ctx.currentTime + 0.01;
    midis.forEach((midi) => {
      if (sample) {
        playSampleAt(ctx, sample, midi, at, durationMs);
      } else {
        playFallbackToneAt(ctx, midi, at, durationMs);
      }
    });
  };

  const stopAll = (): void => {
    activeSources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Ignore stop errors for already-ended sources.
      }
    });
    activeSources.clear();
  };

  const destroy = async (): Promise<void> => {
    stopAll();
    if (audioContext && audioContext.state !== "closed") {
      await audioContext.close();
    }
    audioContext = null;
    sampleBuffer = null;
    sampleLoadPromise = null;
  };

  return {
    playMidi,
    playChord,
    stopAll,
    destroy,
  };
}
