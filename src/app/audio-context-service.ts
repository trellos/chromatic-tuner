// Shared iOS-aware AudioContext factory.
// Handles the webkit-prefixed constructor and the iOS warmup path
// that reduces first-start failures on Safari.

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

export type AudioContextService = {
  createContext(): Promise<AudioContext>;
  readonly isIOS: boolean;
};

export function createAudioContextService(): AudioContextService {
  function getAudioCtor(): typeof AudioContext | null {
    return (
      window.AudioContext ??
      ((window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext ?? null)
    );
  }

  async function createContext(): Promise<AudioContext> {
    const AudioCtx = getAudioCtor();
    if (!AudioCtx) throw new Error("AudioContext is not available in this browser.");

    if (!isIOS) {
      return new AudioCtx({ latencyHint: "interactive" });
    }

    // On iOS, Web Audio defaults to the "ambient" session category which is
    // silenced by the hardware ringer switch. Setting type to "playback" routes
    // audio through the media channel so it plays even when the ringer is off.
    // Supported in iOS 16.4+ (Safari 16.4+); silently ignored on older versions.
    try {
      (navigator as any).audioSession.type = "playback";
    } catch {
      // Not supported on this iOS version; audio will still work but may be
      // silenced by the ringer switch.
    }

    // iOS Safari initialises the AudioContext sample rate based on the hardware
    // output state at the moment of creation. If the context is created "cold"
    // (before any audio playback has occurred), Safari can assign the wrong
    // sample rate. The microphone input is then resampled to match, which shifts
    // every detected pitch by up to a semitone — the root cause of the half-step
    // detection error observed on iOS before this warmup was added.
    // Playing a 1-sample silent buffer through a throwaway context forces the
    // audio hardware to fully initialise at the correct rate before we create
    // the real context that will process mic input.
    try {
      const warmup = new AudioCtx({ latencyHint: "interactive" });
      await warmup.resume();
      const buffer = warmup.createBuffer(1, 1, warmup.sampleRate);
      const source = warmup.createBufferSource();
      source.buffer = buffer;
      source.connect(warmup.destination);
      source.start(0);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (warmup.state !== "closed") {
        await warmup.close();
      }
    } catch {
      // If warmup fails, fall through to a normal context.
    }

    return new AudioCtx({ latencyHint: "interactive" });
  }

  return { createContext, isIOS };
}
