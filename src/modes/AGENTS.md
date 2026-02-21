# Modes Guide

This file describes how mode modules should be structured today and how to keep them maintainable.

## Mode Contract

Each mode module exports a factory returning `ModeDefinition` (`src/modes/types.ts`):
- identity (`id`, `title`, `icon`)
- capabilities (`preserveState`, `canFullscreen`)
- lifecycle hooks (`onEnter`, `onExit`)

`src/main.ts` owns mode switching; mode files own mode-specific behavior.

## Current Mode Intent

### Chromatic Tuner (`src/modes/tuner.ts`)
- Real-time pitch detection with strobe-style feedback.
- `onEnter`: attach tuner UI behavior and start audio path.
- `onExit`: stop audio and remove listener/timer resources.
- Background effect contract:
  - Emits absolute cents detune magnitude to seigaiha background state.
  - Uses piecewise interpolation mapping (`abs cents -> randomness`) configured in UI debug controls.
  - When no note is detected, background randomness decays toward zero over ~1 second.
  - Debug slider override (when enabled) supersedes tuner-driven mapping.

### Metronome (`src/modes/metronome.ts`)
- Tempo dial, start/stop scheduling, time-menu accents.
- `onEnter`: attach controls and sync UI state.
- `onExit`: stop scheduler and detach listeners.
- Background effect contract:
  - While playing, emits time-based seigaiha randomness each animation frame.
  - `no-accent` mode uses a beat-centered sawtooth-like ramp (`0` on beat, `NA` at half-beat).
  - Accented signatures use per-beat growth increments by signature (`I44`, `I34`, `I68`) with curve controls (`UP`, `DN`) and reset to `0` at bar start.
  - On stop/exit, mode randomness is reset/cleared so non-metronome modes can drive background state.
- **Hard UI/audio invariants (do not remove without explicit product sign-off):**
  - The metronome sound dropdown must be able to render beyond the bottom of the metronome card (no clipping at `.mode-screen` or `.mode-stage`).
  - Opening the metronome sound selector must not create a scrollbar in the metronome card.
  - Sound selection must audibly change playback immediately.
  - Keep freely-usable sample sources configured for all metronome sound profiles (`electro`, `drum`, `conga`) with both regular and accent URLs, and preserve per-profile fallback tones so sound changes remain audible if sample fetching fails.
  - Preserve regression coverage in `tests/ui.spec.ts` for the metronome sound menu overflow + no-scrollbar behavior.

### Drum Machine (`src/modes/drum-machine.ts`)
- 4-row, 16-step sequencer with presets and playhead.
- Fullscreen is supported only in this mode.
- `onEnter`: bind controls, sync layout, seed initial pattern once.
- `onExit`: stop scheduler and detach listeners/observers.
- Background effect contract:
  - Does not currently drive seigaiha randomness directly.
  - Background follows global/default state unless another mode-specific source is active.

## Guardrails

- Keep cross-mode coupling out of mode files.
- Keep lifecycle cleanup complete: timers, observers, event listeners, and audio nodes must be released on `onExit`.
- Prefer small helper functions over nested control flow.

## Pruning Rules (No Bush)

When changing a mode, remove vestigial pieces in the same PR:
1. Remove old branches for removed product decisions.
2. Delete unused helpers/constants immediately.
3. Collapse abstractions that no longer vary (for example, if only one layout remains).
4. Update related tests/comments to match final behavior.

Do not preserve dead paths "for later" unless explicitly requested.
