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

### Metronome (`src/modes/metronome.ts`)
- Tempo dial, start/stop scheduling, time-menu accents.
- `onEnter`: attach controls and sync UI state.
- `onExit`: stop scheduler and detach listeners.

### Drum Machine (`src/modes/drum-machine.ts`)
- 4-row, 16-step sequencer with presets and playhead.
- Fullscreen is supported only in this mode.
- `onEnter`: bind controls, sync layout, seed initial pattern once.
- `onExit`: stop scheduler and detach listeners/observers.

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
