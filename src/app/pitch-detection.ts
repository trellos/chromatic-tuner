// Module-level singleton pitch detection service.
// Import this from any mode or widget that needs pitch data.
import {
  createPitchDetectionService,
  type PitchDetectionService,
  type PitchDetectionListener,
  type PitchResult,
} from "./pitch-detection-service.js";

export type { PitchDetectionService, PitchDetectionListener, PitchResult };

export const pitchService: PitchDetectionService = createPitchDetectionService();
