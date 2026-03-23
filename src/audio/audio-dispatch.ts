import { getOrCreateAudioContext } from "../utils.js";

/**
 * Shared AudioContext owner.
 * A single instance should be created per Wild Tuna session and passed to
 * the drum machine, guitar player, and fretboard player so they all share
 * one AudioContext (and therefore one clock for scheduling).
 */
export type AudioDispatch = {
  getContext(): Promise<AudioContext | null>;
};

export function createAudioDispatch(): AudioDispatch {
  let ctx: AudioContext | null = null;
  return {
    async getContext() {
      ctx = await getOrCreateAudioContext(ctx);
      return ctx;
    },
  };
}
