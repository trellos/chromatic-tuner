// Mutable debug parameters shared between the debug panel and mode factories.
// The debug panel modifies them; mode factories read them.
import type { MetronomeRandomnessParams } from "../modes/metronome.js";
import { clamp } from "../utils.js";

export const DEFAULT_METRONOME_RANDOMNESS_PARAMS: MetronomeRandomnessParams = {
  naMax: 0.2,
  inc44: 0.17,
  inc34: 0.2,
  inc68: 0.14,
  upCurve: 1.8,
  downCurve: 3.2,
};

export const DEFAULT_DRUM_RANDOMNESS_TARGET = 0.9;

let _metronomeParams: MetronomeRandomnessParams = {
  ...DEFAULT_METRONOME_RANDOMNESS_PARAMS,
};
let _drumTarget = DEFAULT_DRUM_RANDOMNESS_TARGET;

export function getMetronomeRandomnessParams(): MetronomeRandomnessParams {
  return _metronomeParams;
}

export function setMetronomeRandomnessParams(params: MetronomeRandomnessParams): void {
  _metronomeParams = params;
}

export function getDrumRandomnessTarget(): number {
  return _drumTarget;
}

export function setDrumRandomnessTarget(target: number): void {
  _drumTarget = clamp(target, 0, 1);
}
