import type { ModeDefinition } from "./types.js";

export function createDrumMachineMode(): ModeDefinition {
  return {
    id: "drum-machine",
    title: "Drum Machine",
    icon: "DR",
    preserveState: true,
    canFullscreen: true,
  };
}

