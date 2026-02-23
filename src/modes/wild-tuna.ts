import type { ModeDefinition } from "./types.js";

type WildTunaModeOptions = {
  onRandomnessChange?: (randomness: number | null) => void;
};

const RANDOMNESS_PEAK = 0.8;
const RANDOMNESS_CYCLE_MS = 2000;

export function createWildTunaMode(options: WildTunaModeOptions = {}): ModeDefinition {
  let randomnessRafId: number | null = null;
  let randomnessStartTime = 0;

  const stopRandomnessCycle = (clearValue: boolean): void => {
    if (randomnessRafId !== null) {
      window.cancelAnimationFrame(randomnessRafId);
      randomnessRafId = null;
    }
    if (clearValue) {
      options.onRandomnessChange?.(null);
    }
  };

  const startRandomnessCycle = (): void => {
    stopRandomnessCycle(false);
    randomnessStartTime = performance.now();

    const tick = (now: number): void => {
      const elapsedMs = (now - randomnessStartTime) % RANDOMNESS_CYCLE_MS;
      const progress = elapsedMs / RANDOMNESS_CYCLE_MS;
      // Triangle wave: 0 -> 1 -> 0 over a full cycle.
      const oscillation = 1 - Math.abs(progress * 2 - 1);
      options.onRandomnessChange?.(oscillation * RANDOMNESS_PEAK);
      randomnessRafId = window.requestAnimationFrame(tick);
    };

    randomnessRafId = window.requestAnimationFrame(tick);
  };

  return {
    id: "wild-tuna",
    title: "Wild Tuna",
    icon: "WT",
    preserveState: false,
    canFullscreen: true,
    onEnter: () => {
      startRandomnessCycle();
    },
    onExit: () => {
      stopRandomnessCycle(true);
    },
  };
}
