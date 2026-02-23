import { createDrumMachineUi, getDrumRandomnessForBeat, getDrumSoundingBeatIndicesFromFlags, type DrumMachineUiOptions } from "../ui/drum-machine.js";
import type { ModeDefinition } from "./types.js";

export { getDrumRandomnessForBeat, getDrumSoundingBeatIndicesFromFlags };

export function createDrumMachineMode(options: DrumMachineUiOptions = {}): ModeDefinition {
  const modeEl = document.querySelector<HTMLElement>('.mode-screen[data-mode="drum-machine"]');
  const drumUi = modeEl ? createDrumMachineUi(modeEl, options) : null;

  return {
    id: "drum-machine",
    title: "Drum Machine",
    icon: "DR",
    preserveState: true,
    canFullscreen: true,
    onEnter: async () => {
      await drumUi?.enter();
    },
    onExit: () => {
      drumUi?.exit();
    },
  };
}
