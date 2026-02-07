import type { ModeDefinition } from "./types.js";

export function createMetronomeMode(): ModeDefinition {
  return {
    id: "metronome",
    title: "Metronome",
    icon: "MT",
    preserveState: false,
    canFullscreen: false,
  };
}

