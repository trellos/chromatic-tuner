// Module-level singleton bridge to the seigaiha background animation.
// Import this from any mode or widget that drives randomness or detune magnitude.
import {
  setSeigaihaDetuneMagnitude,
  setSeigaihaModeRandomness,
  pulseSeigaihaRandomness,
} from "../ui/seigaihaBackground.js";

export type SeigaihaBridge = {
  setDetuneMagnitude(absCents: number | null): void;
  setModeRandomness(randomness: number | null): void;
  pulse(): void;
};

function createSeigaihaBridge(): SeigaihaBridge {
  return {
    setDetuneMagnitude: setSeigaihaDetuneMagnitude,
    setModeRandomness: setSeigaihaModeRandomness,
    pulse: pulseSeigaihaRandomness,
  };
}

export const seigaihaBridge: SeigaihaBridge = createSeigaihaBridge();
