// Clamps value to the inclusive [min, max] range.
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Returns the existing AudioContext if it is still open, or creates a new one.
// Handles the webkit-prefixed constructor for older Safari/iOS.
// Always calls resume() before returning so the context is ready for playback.
export async function getOrCreateAudioContext(
  existing: AudioContext | null
): Promise<AudioContext | null> {
  if (existing && existing.state !== "closed") {
    await existing.resume();
    return existing;
  }
  const AudioCtor =
    window.AudioContext ??
    ((window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null);
  if (!AudioCtor) return null;
  // Route audio through media channel so it plays even when the ringer is off (iOS 16.4+).
  try { (navigator as any).audioSession.type = "playback"; } catch { /* not supported */ }
  const ctx = new AudioCtor({ latencyHint: "interactive" });
  await ctx.resume();
  return ctx;
}
