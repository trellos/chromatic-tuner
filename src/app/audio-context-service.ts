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

    // iOS Safari can report a "bad" audio context on first init.
    // Warm up with a short silent buffer, then create the real context.
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
