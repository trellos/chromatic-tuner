import type { ModeDefinition } from "./modes/types.js";
import { createTunerMode } from "./modes/tuner.js";
import { createMetronomeMode } from "./modes/metronome.js";
import { createDrumMachineMode } from "./modes/drum-machine.js";

const MODE_REGISTRY: ModeDefinition[] = [
  createTunerMode(),
  createMetronomeMode(),
  createDrumMachineMode(),
];

// Auto-start tuner mode on page load until the carousel is wired up.
window.addEventListener("DOMContentLoaded", async () => {
  const tunerMode = MODE_REGISTRY.find((mode) => mode.id === "tuner");
  if (tunerMode?.onEnter) {
    await tunerMode.onEnter();
  }
});
 
