import {
  FRETBOARD_SAMPLE_BASE_MIDI,
  FRETBOARD_SAMPLE_GAIN,
  fetchFretboardSample,
} from "./fretboard-sample.js";
import type { AudioDispatch } from "./audio-dispatch.js";

export type FretboardPlayer = {
  startSustain(targets: Array<{ midi: number; stringIndex: number }>): Promise<void>;
  stopSustain(): void;
  playTargets(
    targets: Array<{ midi: number; stringIndex: number }>,
    durationMs: number
  ): Promise<void>;
  playMidis(midis: number[], durationMs: number): Promise<void>;
};

export function createFretboardPlayer(dispatch: AudioDispatch): FretboardPlayer {
  let fretSample: AudioBuffer | null = null;
  let sustainVoice: { sources: AudioBufferSourceNode[]; gains: GainNode[] } | null = null;

  const ensureSample = async (ctx: AudioContext): Promise<AudioBuffer | null> => {
    if (fretSample) return fretSample;
    fretSample = await fetchFretboardSample(ctx);
    return fretSample;
  };

  const stopSustain = (): void => {
    const voice = sustainVoice;
    if (!voice) return;
    sustainVoice = null;
    // Use a tiny release ramp so the cut-off is not a click.
    const releaseSec = 0.09;
    // We can't retrieve the context from voice nodes directly, but if the
    // dispatch context was created it will be available synchronously here.
    dispatch.getContext().then((ctx) => {
      if (!ctx) return;
      const now = ctx.currentTime;
      voice.gains.forEach((gain) => {
        const current = Math.max(0.0001, gain.gain.value);
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(current, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + releaseSec);
      });
      voice.sources.forEach((source) => {
        try { source.stop(now + releaseSec + 0.02); } catch { /* already stopped */ }
      });
    }).catch(() => { /* ignore */ });
  };

  const startSustain = async (
    targets: Array<{ midi: number; stringIndex: number }>
  ): Promise<void> => {
    stopSustain();
    const ctx = await dispatch.getContext();
    if (!ctx) return;
    const sample = await ensureSample(ctx);
    if (!sample) return;
    const loopStart = sample.duration * 0.30;
    const loopEnd = sample.duration * 0.82;
    const at = ctx.currentTime + 0.008;
    const sources: AudioBufferSourceNode[] = [];
    const gains: GainNode[] = [];
    for (const { midi } of targets) {
      const source = ctx.createBufferSource();
      source.buffer = sample;
      source.playbackRate.value = Math.pow(2, (midi - FRETBOARD_SAMPLE_BASE_MIDI) / 12);
      source.loop = true;
      source.loopStart = loopStart;
      source.loopEnd = loopEnd;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(FRETBOARD_SAMPLE_GAIN, at + 0.02);
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(at);
      sources.push(source);
      gains.push(gain);
    }
    sustainVoice = { sources, gains };
  };

  const playTargets = async (
    targets: Array<{ midi: number; stringIndex: number }>,
    durationMs: number
  ): Promise<void> => {
    if (!targets.length) return;
    const ctx = await dispatch.getContext();
    if (!ctx) return;
    const sample = await ensureSample(ctx);
    const startAt = ctx.currentTime + 0.01;
    targets.forEach(({ midi }) => {
      if (sample) {
        const source = ctx.createBufferSource();
        source.buffer = sample;
        source.playbackRate.value = Math.pow(2, (midi - FRETBOARD_SAMPLE_BASE_MIDI) / 12);
        const gain = ctx.createGain();
        gain.gain.value = FRETBOARD_SAMPLE_GAIN;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(startAt);
        source.stop(startAt + durationMs / 1000);
      }
    });
  };

  return {
    startSustain,
    stopSustain,
    playTargets,
    playMidis: (midis, durationMs) =>
      playTargets(midis.map((midi) => ({ midi, stringIndex: 0 })), durationMs),
  };
}
