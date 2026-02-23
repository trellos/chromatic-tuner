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

### Fretboard (`src/modes/fretboard.ts` + `src/modes/fretboard-logic.ts`)
- Interactive guitar fretboard for scales/chords with note or degree annotations.
- Default state on first load: `C` root, `scale` display, `major` characteristic, `notes` annotation.
- `onEnter`: bind root/display/annotation controls, characteristic select, dot taps, and play action.
- `onExit`: detach listeners, stop scheduled playback, clear randomness animation, and close audio context.
- Dot generation/theory contract (keep in `src/modes/fretboard-logic.ts`):
  - Generate included notes from interval maps by `display` + `characteristic`.
  - Render frets `0..12` across standard tuning (low E to high E).
  - Degree labels use chromatic spellings where semitone `8` is `b6` (not `#5`).
  - Chord aliases must normalize consistently (`sus2`, `sus4`, human labels).
- Visual/layout invariants:
  - Open-string indicators are hollow circles in the header lane above the nut.
  - Open-string indicators are positioned between the string labels and nut and remain tappable.
  - Root notes use the accent styling in both note and degree annotation modes.
  - Note dots remain centered on their string and centered between adjacent frets.
  - Fret inlays remain visible even when note dots overlap them (including dual 12th-fret inlays).
  - In portrait/mobile, keep fretboard + controls visible together; do not require internal panel scrolling to reach the 12th fret and its inlays.
- Controls contract:
  - Root buttons (`[data-fretboard-root]`): select tonic and rerender.
  - Display buttons (`[data-fretboard-display]`): switch `scale`/`chord` and refresh characteristic options.
  - Characteristic select (`#fretboard-characteristic`): scale/chord quality choice for current display mode.
  - Annotation buttons (`[data-fretboard-annotation]`): switch label text between note names and degrees.
  - Play button (`[data-fretboard-play]`): audition current selection.
    - Scale mode: play notes in ascending order including top octave.
    - Chord mode: play all chord tones together for ~1 second.
- Audio contract:
  - Dot tap playback: tapping any fretted note or open indicator plays its pitch.
  - Preferred source is a loaded guitar sample (`assets/audio/fretboard/guitar-acoustic-c4.mp3`) pitch-shifted by MIDI offset.
  - Fallback source is a synthesized oscillator tone if sample fetch/decode fails.
  - Audio should initialize lazily on user interaction and be cleaned up on mode exit.
- Seigaiha/background contract:
  - Global button clicks (wired in `src/main.ts`) trigger a short randomness pulse: jump into `[0.2, 0.4]`, then decay to `0` over ~500ms.
  - Play action drives a stronger playback envelope: start near `0.8`, then decay to `0` when playback completes.
  - Mode exit must clear/neutralize fretboard-owned randomness (`null`) so other modes can drive background state.

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

### Circle of Fifths (`src/modes/circle-of-fifths.ts`)
- Dedicated mode is a thin adapter over shared Circle UI (`src/ui/circle-of-fifths.ts`).
- Taps should trigger guitar-sample playback + seigaiha pulse, but keep theory/render logic in shared UI helpers.
- Keep this mode focused on lifecycle wiring (`onEnter`/`onExit`) and cleanup only.

### Tuner Circle toggle (`src/modes/tuner.ts`)
- Tuner supports visual sub-modes (`strobe`, `circle`) via in-mode toggle.
- Pitch detection drives Circle primary note + detune-guidance rotation when Circle view is active.
- No detected note must clear Circle primary and hide inner detail wedges.
