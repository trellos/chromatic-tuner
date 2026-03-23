# Modes Guide

This file describes how mode modules should be structured today and how to keep them maintainable.

## Mode Contract

Each mode module exports a factory returning `ModeDefinition` (`src/modes/types.ts`):
- identity (`id`, `title`)
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
- Thin mode adapter over `src/ui/drum-machine.ts`.
- 4-row, 16-step sequencer with presets and playhead.
- Fullscreen is supported only in this mode (and Wild Tuna).
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

### Circle of Fifths (`src/modes/circle-of-fifths.ts`)
- Dedicated mode is a thin adapter over shared Circle UI (`src/ui/circle-of-fifths.ts`) plus the shared playback controller (`src/app/circle-audio-controller.ts`).
- Taps trigger guitar-sample playback + seigaiha pulse; keep theory/render logic in shared UI helpers.
- Keep this mode focused on lifecycle wiring (`onEnter`/`onExit`) and cleanup only.
- Interaction contract:
  - CCW 40% of wedge: plays single note only, no primary change.
  - CW 60% of wedge: plays major chord; sets inner circle primary (except IV/V which don't move primary).
  - Hold on CCW zone: sustains single note.
  - Hold on CW zone: sustains major chord.
  - Tap outside circle: clears inner circle (no sound).
  - There is no chord mode state, zoom, or double-tap entry into a different interaction mode.
- Background randomness contract:
  - On chord tap: pulse to high randomness then ease down.
  - On note tap: shorter randomness pulse.
  - On hold: oscillates between min/max while held.
  - On release: eases back down.

### Tuner Circle toggle (`src/modes/tuner.ts`)
- Tuner supports visual sub-modes (`strobe`, `circle`) via in-mode toggle.
- Pitch detection drives Circle primary note + detune-guidance rotation when Circle view is active.
- No detected note must clear Circle primary and hide inner detail wedges.

### Wild Tuna (`src/modes/wild-tuna.ts`)
- Three-pane jam mode: Drum Machine | Circle of Fifths | Fretboard with synchronized MIDI loop recording.
- Entry point: `src/modes/wild-tuna.ts` (coordinator + mode wiring).
- Reusable looper widget: `src/ui/ui-composite-looper.ts` (two instances: circle + fretboard).
- The drum machine transport drives all timing; loopers receive `onTransportStart/Stop/BeatBoundary`.
- **Recording flow:**
  - REC press calls `coordinator.onRecPressed(source)`.
  - If transport is already playing: `source.requestArm()` → arms on next measure boundary → starts recording.
  - If transport is stopped: drum machine plays a 4-beat woodblock count-in at current BPM. After count-in, `requestArm()` fires synchronously, then `startTransport()` fires asynchronously. The looper handles this ordering: `requestArm()` pre-sets `isTransportPlaying = true` so beat boundaries aren't skipped, and `onTransportStart()` is a no-op when already armed/recording.
  - Only one looper can record at a time; pressing REC on one stops any other recording looper.
  - Recording auto-stops after 4 measures (`MAX_MEASURES`).
  - A `recordingSeekTarget` (separate from `pendingSeekMeasure`) survives count-in beat boundaries so a pre-press seek is applied when recording begins.
- **Timeline:** `buildWildTunaTimeline` renders 4 tappable measure blocks between the drum pane and the circle/fretboard panes. Each block contains 16 `.wt-timeline-step` spans that light up based on note density per step across all loopers. Tapping a block seeks all loopers to that measure.
- **Looper controls:** REC button (indicator dot: dim=idle, pink=armed, red+blink=recording) and CLR button. No PLAY button.
- **Save/load:** Share button serializes drum pattern + circle loop + fretboard loop to `?mode=wild-tuna&track=<base64url(JSON)>`. `onEnter` hydrates from URL if present.
- **Fretboard state** (root, scale/chord mode, characteristic) is not serialized in share URLs.
- **Seigaiha:** `noteTracker` converts active note count to a randomness value fed to `seigaihaBridge`; decays when notes stop sounding.
- **Track API:** `getWildTunaTrackApi()` returns a `WildTunaTrackApi` with `onNoteOn`/`onNoteOff`/`getActiveNotes` aggregating playback events from both loopers. The singleton is recreated on each `onEnter` via `_reset()`.
- Shared note-event aggregation lives in `src/app/note-events.ts`; preserve stacked note/chord pulses as separate active notes so rapid re-attacks stay visible to subscribers.
- Shared real-time routing lives in `src/app/audio-session.ts`; keep it narrow (instrument registration, active note lifecycle, subscriber fanout) and do not move geometry or looper timing into it.
- **CSS:** Layout in `public/styles/00-foundation.css` (`.wild-tuna-composite` grid). Timeline block + step styles: `.wt-timeline-block`, `.wt-timeline-step` in the same file. Looper widget styles: `public/styles/60-circle-of-fifths.css`.

## Guardrails

- Keep cross-mode coupling out of mode files.
- Keep lifecycle cleanup complete: timers, observers, event listeners, and audio nodes must be released on `onExit`.
- Prefer small helper functions over nested control flow.
- Mode files must NOT contain rendering logic. All drawing belongs in `src/ui/` objects.
- Mode files must NOT call audio player methods directly. Route audio through `src/app/audio-session.ts`
  or a dedicated audio controller (`src/app/circle-audio-controller.ts`).
- `src/modes/wild-tuna.ts` is a coordinator. Its only legitimate responsibilities are:
  looper synchronization, transport wiring, URL share payload encode/decode, and mode lifecycle.
  If you find yourself adding audio dispatch or rendering code here, move it to the appropriate `src/ui/` or `src/app/` module.

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
