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
  - Metronome sound menu click handling must resolve from nested click targets (use closest menu-item button semantics) so selection always works.
  - Switching metronome sound while transport is running must apply to newly scheduled clicks immediately; any click source already started may finish naturally.
  - Keep per-sound sample loading/caching resilient to rapid switching so stale async fetch completion cannot overwrite a newer sound choice.
  - Keep freely-usable sample sources configured for all metronome sound profiles (`woodblock`, `electro`, `drum`, `conga`) with both regular and accent URLs, and preserve per-profile fallback tones so sound changes remain audible if sample fetching fails.
  - Preserve regression coverage in `tests/ui.spec.ts` for the metronome sound menu overflow + no-scrollbar behavior.

### Drum Machine (`src/modes/drum-machine.ts`)
- 4-row, 16-step sequencer with presets and playhead.
- Fullscreen is supported only in this mode.
- `onEnter`: bind controls, sync layout, seed initial pattern once.
- `onExit`: stop scheduler and detach listeners/observers.
- Fullscreen layout behavior is controlled by existing responsive CSS/media rules; do not add no-op class toggles without matching styles.
- Background effect contract:
  - Drives seigaiha randomness while in drum mode.
  - Randomness updates in beat-sized jumps (no per-frame interpolation).
  - At each beat boundary, randomness can update only if that beat window contains at least one active step.
  - The first sounding beat in each bar is always `0`.
  - Later sounding beats linearly interpolate toward target by sounding-beat rank; the last sounding beat reaches target.
  - Target is debug-tunable in the shared seigaiha debug panel (`TG` field, default `0.9`).
  - Drum kit menu click handling must resolve from nested click targets (use closest menu-item button semantics) so kit selection always works.
  - Switching drum kit while transport is running must apply to newly scheduled steps immediately; any already-started sample source may finish naturally.
  - Keep kit sample loading/caching resilient to rapid switching so stale async fetch completion cannot overwrite the currently selected kit.
  - Keep sample URLs in mode code pointed at bundled project assets so kit/sound switching remains deterministic offline.
- Share URL track format (`?track=<base64url(JSON)>`):
  - Include `mode=drum-machine` in generated share URLs so links open directly in drum mode.
  - JSON payload is versioned with `version` (currently `1`) and must remain backward-compatible when evolving.
  - Current `version: 1` payload fields:
    - `version`: number (`1`)
    - `bpm`: number (`60..180`)
    - `kit`: kit id (`rock|electro|house|lofi|latin`)
    - `steps`: 64-char bitstring (`0|1`), row-major order over 4 rows × 16 steps (this is the user-edited loop)
  - Do not serialize the beat preset selector value in new links; share payloads must preserve the actual edited loop, plus kit and tempo.
  - Parser should continue accepting legacy `v` (number) as version fallback for already-shared links, but new links should emit `version`.

## Audio Asset Hydration Guardrail

- Bundled metronome/drum `.wav` assets under `public/assets/audio` are tracked with Git LFS (`.gitattributes`), so local clones/CI must hydrate LFS objects before running the app.
- `npm run build` and `npm run dev` now execute `scripts/verify-audio-assets.mjs` before bundling/startup. This check fails if any `public/assets/audio/**/*.wav` file is still an LFS pointer (or malformed non-RIFF data).
- If the verifier fails, run `git lfs pull --include="public/assets/audio/**"` and retry.

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

## PR Notes for Codex Sessions

- Keep PR title/body plain ASCII and concise when possible.
- If PR creation returns a 400 from host integration, retry with a shorter title and a minimal body first, then expand only if accepted.
