export type CircleInstrumentId =
  | "guitar-acoustic"
  | "guitar-electric"
  | "guitar-spanish"
  | "organ-pipe"
  | "organ-house";

type CircleInstrumentSpec = {
  id: CircleInstrumentId;
  name: string;
  sampleUrl: string;
  baseMidi: number;
  gain: number;
  lowpassHz?: number;
  highpassHz?: number;
};

type SustainVoice = {
  sources: AudioBufferSourceNode[];
  gains: GainNode[];
};

const CIRCLE_INSTRUMENTS: ReadonlyArray<CircleInstrumentSpec> = [
  {
    id: "guitar-acoustic",
    name: "ACOUSTIC GUITAR",
    sampleUrl: "assets/audio/circle/guitar-acoustic-c4.mp3",
    baseMidi: 60,
    gain: 0.84,
  },
  {
    id: "guitar-electric",
    name: "ELECTRIC GUITAR",
    sampleUrl: "assets/audio/circle/guitar-electric-c4.mp3",
    baseMidi: 60,
    gain: 0.74,
    lowpassHz: 3600,
  },
  {
    id: "guitar-spanish",
    name: "SPANISH GUITAR",
    sampleUrl: "assets/audio/circle/guitar-spanish-cs4.mp3",
    baseMidi: 61,
    gain: 0.82,
    lowpassHz: 3400,
  },
  {
    id: "organ-pipe",
    name: "PIPE ORGAN",
    sampleUrl: "assets/audio/circle/organ-pipe-c4.mp3",
    baseMidi: 60,
    gain: 0.56,
    lowpassHz: 3000,
  },
  {
    id: "organ-house",
    name: "HOUSE ORGAN",
    sampleUrl: "assets/audio/circle/organ-house-c4.mp3",
    baseMidi: 60,
    gain: 0.62,
    highpassHz: 120,
  },
];

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
  startSustainMidi: (midi: number) => Promise<void>;
  startSustainChord: (midis: number[]) => Promise<void>;
  stopSustain: () => void;
  cycleInstrument: () => string;
  setInstrument: (instrumentId: CircleInstrumentId) => string;
  getInstrumentName: () => string;
  /** Pre-fetches the raw bytes for the current instrument so decodeAudioData is
   *  the only remaining work when the first note is played. Safe to call without
   *  an AudioContext — no decoding happens here. */
  preloadCurrentInstrument: () => void;
  stopAll: () => void;
  destroy: () => Promise<void>;
};

export function createCircleGuitarPlayer(): CircleGuitarPlayer {
  let audioContext: AudioContext | null = null;
  const sampleBytesByUrl = new Map<string, ArrayBuffer>();
  const sampleBytesPromiseByUrl = new Map<string, Promise<ArrayBuffer | null>>();
  const sampleBufferByUrl = new Map<string, AudioBuffer>();
  const sampleLoadPromiseByUrl = new Map<string, Promise<AudioBuffer | null>>();
  const sampleLoopRegionByUrl = new Map<string, { startSec: number; endSec: number }>();
  const activeSources = new Set<AudioScheduledSourceNode>();
  let instrumentIndex = 0;
  let sustainVoice: SustainVoice | null = null;
  let sustainStopRequested = false;

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

  const prefetchSampleBytes = (sampleUrl: string): Promise<ArrayBuffer | null> => {
    const cached = sampleBytesByUrl.get(sampleUrl);
    if (cached) return Promise.resolve(cached);
    const inFlight = sampleBytesPromiseByUrl.get(sampleUrl);
    if (inFlight) return inFlight;
    const promise = (async () => {
      try {
        const response = await fetch(sampleUrl);
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        sampleBytesByUrl.set(sampleUrl, bytes);
        return bytes;
      } catch {
        return null;
      } finally {
        sampleBytesPromiseByUrl.delete(sampleUrl);
      }
    })();
    sampleBytesPromiseByUrl.set(sampleUrl, promise);
    return promise;
  };

  const ensureSample = async (ctx: AudioContext, sampleUrl: string): Promise<AudioBuffer | null> => {
    const cached = sampleBufferByUrl.get(sampleUrl);
    if (cached) return cached;

    const inFlight = sampleLoadPromiseByUrl.get(sampleUrl);
    if (inFlight) return inFlight;

    const sampleLoadPromise = (async () => {
      try {
        const bytes = await prefetchSampleBytes(sampleUrl);
        if (!bytes) return null;
        const decoded = await ctx.decodeAudioData(bytes.slice(0));
        sampleBufferByUrl.set(sampleUrl, decoded);
        return decoded;
      } catch {
        return null;
      } finally {
        sampleLoadPromiseByUrl.delete(sampleUrl);
      }
    })();
    sampleLoadPromiseByUrl.set(sampleUrl, sampleLoadPromise);
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
    instrument: CircleInstrumentSpec,
    midi: number,
    startTimeSec: number,
    durationMs: number
  ): void => {
    const source = ctx.createBufferSource();
    source.buffer = sample;
    source.playbackRate.value = Math.pow(2, (midi - instrument.baseMidi) / 12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(instrument.gain, startTimeSec);

    let outputNode: AudioNode = source;
    if (instrument.highpassHz) {
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.setValueAtTime(instrument.highpassHz, startTimeSec);
      outputNode.connect(highpass);
      outputNode = highpass;
    }
    if (instrument.lowpassHz) {
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.setValueAtTime(instrument.lowpassHz, startTimeSec);
      outputNode.connect(lowpass);
      outputNode = lowpass;
    }

    outputNode.connect(gain);
    gain.connect(ctx.destination);
    registerSource(source);
    source.start(startTimeSec);
    source.stop(startTimeSec + Math.max(0.05, durationMs / 1000));
  };

  const findNearestZeroCrossing = (
    samples: Float32Array,
    center: number,
    maxOffset: number
  ): number => {
    const clampIndex = (value: number): number =>
      Math.max(1, Math.min(samples.length - 2, value));
    let bestIndex = clampIndex(center);
    let bestScore = Number.POSITIVE_INFINITY;
    for (let offset = 0; offset <= maxOffset; offset += 1) {
      const candidates = offset === 0 ? [center] : [center - offset, center + offset];
      for (const rawCandidate of candidates) {
        const idx = clampIndex(rawCandidate);
        const prev = samples[idx - 1] ?? 0;
        const current = samples[idx] ?? 0;
        const next = samples[idx + 1] ?? 0;
        const signChange = (prev <= 0 && current >= 0) || (prev >= 0 && current <= 0);
        const localScore = Math.abs(current) + Math.abs(next - prev) * 0.2;
        const score = signChange ? localScore : localScore + 0.06;
        if (score < bestScore) {
          bestScore = score;
          bestIndex = idx;
        }
      }
    }
    return bestIndex;
  };

  const deriveLoopRegion = (
    sampleUrl: string,
    sample: AudioBuffer
  ): { startSec: number; endSec: number } => {
    const cached = sampleLoopRegionByUrl.get(sampleUrl);
    if (cached) return cached;
    const channel = sample.getChannelData(0);
    const length = channel.length;
    if (length < Math.max(2048, Math.floor(sample.sampleRate * 0.25))) {
      const fallback = { startSec: 0, endSec: Math.max(0.1, sample.duration) };
      sampleLoopRegionByUrl.set(sampleUrl, fallback);
      return fallback;
    }

    const startCandidate = Math.floor(length * 0.3);
    const endCandidate = Math.floor(length * 0.82);
    const startSample = findNearestZeroCrossing(channel, startCandidate, 4096);
    let endSample = findNearestZeroCrossing(channel, endCandidate, 4096);
    const minimumLoopSamples = Math.floor(sample.sampleRate * 0.16);
    if (endSample - startSample < minimumLoopSamples) {
      endSample = Math.min(length - 2, startSample + minimumLoopSamples);
    }
    const region = {
      startSec: startSample / sample.sampleRate,
      endSec: endSample / sample.sampleRate,
    };
    sampleLoopRegionByUrl.set(sampleUrl, region);
    return region;
  };

  const stopSustain = (): void => {
    sustainStopRequested = true;
    const voice = sustainVoice;
    if (!voice) return;
    sustainVoice = null;
    const ctx = audioContext;
    const now = ctx?.currentTime ?? 0;
    const releaseSec = 0.09;
    voice.gains.forEach((gain) => {
      const current = Math.max(0.0001, gain.gain.value);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(current, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseSec);
    });
    voice.sources.forEach((source) => {
      try {
        source.stop(now + releaseSec + 0.02);
      } catch {
        // Ignore stop errors for already-ended sources.
      }
    });
  };

  const startSustainWithMidis = async (midis: number[]): Promise<void> => {
    if (!midis.length) return;
    sustainStopRequested = false;
    const ctx = await ensureAudioContext();
    if (!ctx || sustainStopRequested) return;
    const instrument = CIRCLE_INSTRUMENTS[instrumentIndex] ?? CIRCLE_INSTRUMENTS[0]!;
    const sample = await ensureSample(ctx, instrument.sampleUrl);
    if (!sample || sustainStopRequested) return;
    const loopRegion = deriveLoopRegion(instrument.sampleUrl, sample);
    stopSustain();
    sustainStopRequested = false;

    const at = ctx.currentTime + 0.008;
    const sources: AudioBufferSourceNode[] = [];
    const gains: GainNode[] = [];
    midis.forEach((midi) => {
      const source = ctx.createBufferSource();
      source.buffer = sample;
      source.playbackRate.value = Math.pow(2, (midi - instrument.baseMidi) / 12);
      source.loop = true;
      source.loopStart = loopRegion.startSec;
      source.loopEnd = loopRegion.endSec;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.2, instrument.gain), at + 0.02);

      let outputNode: AudioNode = source;
      if (instrument.highpassHz) {
        const highpass = ctx.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.setValueAtTime(instrument.highpassHz, at);
        outputNode.connect(highpass);
        outputNode = highpass;
      }
      if (instrument.lowpassHz) {
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.setValueAtTime(instrument.lowpassHz, at);
        outputNode.connect(lowpass);
        outputNode = lowpass;
      }
      outputNode.connect(gain);
      gain.connect(ctx.destination);
      registerSource(source);
      source.start(at);
      sources.push(source);
      gains.push(gain);
    });

    sustainVoice = { sources, gains };
  };

  const playMidi = async (midi: number, durationMs = 420): Promise<void> => {
    stopSustain();
    const ctx = await ensureAudioContext();
    if (!ctx) return;
    const instrument = CIRCLE_INSTRUMENTS[instrumentIndex] ?? CIRCLE_INSTRUMENTS[0]!;
    const sample = await ensureSample(ctx, instrument.sampleUrl);
    const at = ctx.currentTime + 0.01;
    if (sample) {
      playSampleAt(ctx, sample, instrument, midi, at, durationMs);
      return;
    }
    playFallbackToneAt(ctx, midi, at, durationMs);
  };

  const playChord = async (midis: number[], durationMs = 900): Promise<void> => {
    stopSustain();
    const ctx = await ensureAudioContext();
    if (!ctx) return;
    const instrument = CIRCLE_INSTRUMENTS[instrumentIndex] ?? CIRCLE_INSTRUMENTS[0]!;
    const sample = await ensureSample(ctx, instrument.sampleUrl);
    const at = ctx.currentTime + 0.01;
    midis.forEach((midi) => {
      if (sample) {
        playSampleAt(ctx, sample, instrument, midi, at, durationMs);
      } else {
        playFallbackToneAt(ctx, midi, at, durationMs);
      }
    });
  };

  const stopAll = (): void => {
    stopSustain();
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
    sampleBufferByUrl.clear();
    sampleLoadPromiseByUrl.clear();
    sampleLoopRegionByUrl.clear();
  };

  const preloadCurrentInstrument = (): void => {
    const instrument = CIRCLE_INSTRUMENTS[instrumentIndex] ?? CIRCLE_INSTRUMENTS[0]!;
    void prefetchSampleBytes(instrument.sampleUrl);
  };

  const cycleInstrument = (): string => {
    instrumentIndex = (instrumentIndex + 1) % CIRCLE_INSTRUMENTS.length;
    return CIRCLE_INSTRUMENTS[instrumentIndex]?.name ?? "ACOUSTIC GUITAR";
  };

  const setInstrument = (instrumentId: CircleInstrumentId): string => {
    const idx = CIRCLE_INSTRUMENTS.findIndex((instrument) => instrument.id === instrumentId);
    instrumentIndex = idx >= 0 ? idx : 0;
    return CIRCLE_INSTRUMENTS[instrumentIndex]?.name ?? "ACOUSTIC GUITAR";
  };

  const getInstrumentName = (): string => {
    return CIRCLE_INSTRUMENTS[instrumentIndex]?.name ?? "ACOUSTIC GUITAR";
  };

  return {
    playMidi,
    playChord,
    startSustainMidi: (midi: number) => startSustainWithMidis([midi]),
    startSustainChord: (midis: number[]) => startSustainWithMidis(midis),
    stopSustain,
    preloadCurrentInstrument,
    cycleInstrument,
    setInstrument,
    getInstrumentName,
    stopAll,
    destroy,
  };
}
