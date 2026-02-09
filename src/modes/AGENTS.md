# Modes Guide

This document summarizes each mode’s purpose and the mode-level decisions already made for this project.

## Chromatic Tuner
- Purpose: Real-time pitch detection with strobe-style visual feedback.
- Primary file: `src/modes/tuner.ts`.
- Lifecycle: Initialized and torn down via mode lifecycle hooks (`onEnter`/`onExit`).

## Metronome
- Purpose: Tempo dial, time menu, and beat pulse scheduling.
- Primary file: `src/modes/metronome.ts`.
- Lifecycle: Uses mode lifecycle hooks for scheduler setup/teardown.
- Decision: Time menu includes “No Accent.”

## Drum Machine
- Purpose: 4-row step sequencer with beat presets and playhead.
- Primary file: `src/modes/drum-machine.ts`.
- Lifecycle: Uses mode lifecycle hooks for audio and UI bindings.
- Decisions:
  - Fullscreen is supported only in this mode; other modes do not show a fullscreen toggle.
  - Grid is always 16 steps (no 3/4 or 6/8 grid variants).
  - Toolbar is a straight bar aligned parallel to the grid (no bubble layout).
  - Playhead should move smoothly; the active column can pulse.

## Cross-Mode Decisions
- Modes are managed by lifecycle hooks in `src/modes/*` (do not move lifecycle back into `src/main.ts`).
- Mode switching uses swipe + dots; no named mode buttons in the UI.
- The main white rounded panel remains a consistent size across all modes.
