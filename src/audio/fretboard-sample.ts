// Shared loader for the guitar acoustic sample used by both the Fretboard and Wild Tuna modes.
// Module-level cache keeps the raw bytes around so the file is only fetched once.
// Decoded AudioBuffer is not cached globally because it is tied to a specific AudioContext.

export const FRETBOARD_SAMPLE_URL = "assets/audio/fretboard/guitar-acoustic-c4.mp3";
export const FRETBOARD_SAMPLE_BASE_MIDI = 60;
export const FRETBOARD_SAMPLE_GAIN = 0.84;

let cachedSampleBytes: ArrayBuffer | null = null;
let cachedSampleFetchPromise: Promise<ArrayBuffer | null> | null = null;

async function fetchSampleBytes(): Promise<ArrayBuffer | null> {
  if (cachedSampleBytes) return cachedSampleBytes;
  if (cachedSampleFetchPromise) return cachedSampleFetchPromise;
  cachedSampleFetchPromise = (async () => {
    try {
      const response = await fetch(FRETBOARD_SAMPLE_URL);
      if (!response.ok) return null;
      const bytes = await response.arrayBuffer();
      cachedSampleBytes = bytes;
      return bytes;
    } catch {
      return null;
    } finally {
      cachedSampleFetchPromise = null;
    }
  })();
  return cachedSampleFetchPromise;
}

// Kicks off the network fetch in the background so it is ready before first playback.
export function preloadFretboardSampleBytes(): void {
  void fetchSampleBytes();
}

// Fetches and decodes the guitar sample for the given AudioContext.
// Fetching is deduped across concurrent calls; decoding is per-context.
export async function fetchFretboardSample(ctx: AudioContext): Promise<AudioBuffer | null> {
  try {
    const bytes = await fetchSampleBytes();
    if (!bytes) return null;
    return await ctx.decodeAudioData(bytes.slice(0));
  } catch {
    return null;
  }
}
