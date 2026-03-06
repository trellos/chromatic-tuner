# Copilot Instructions for Chromatic Tuner

## Project Scope

Chromatic Tuner is a browser-based multi-mode music tool. Modes:
- Chromatic Tuner
- Drum Machine
- Circle of Fifths
- Fretboard
- Key Finder
- Wild Tuna (jam mode: Drum Machine + Circle of Fifths + Fretboard with loop recording)
- Extra Jimmy (dual-fretboard harmony mode)

The app runs as a static frontend served by an Express dev server.

## Current Architecture

- `src/main.ts`: mode routing and interaction shell (mode chip picker, swipe, fullscreen toggle wiring).
- `src/mode-transition.ts`: shared transition sequence (`exit -> apply UI -> enter`) with error callback.
- `src/modes/tuner.ts`: tuner mode lifecycle, audio startup/teardown, strobe/circle UI.
- `src/modes/drum-machine.ts`: drum sequencer mode adapter (thin wrapper over `src/ui/drum-machine.ts`).
- `src/modes/circle-of-fifths.ts`: Circle of Fifths mode adapter (thin wrapper over `src/ui/circle-of-fifths.ts`).
- `src/modes/fretboard.ts`: Fretboard mode adapter.
- `src/modes/key-finder.ts`: Key Finder mode.
- `src/modes/wild-tuna.ts`: Wild Tuna jam mode (coordinator + looper instances + track API).
- `src/modes/extra-jimmy.ts`: dual-fretboard harmony mode.
- `src/ui/drum-machine.ts`: reusable drum machine UI object (transport, scheduling, count-in).
- `src/ui/circle-of-fifths.ts`: reusable Circle of Fifths SVG UI (tap zones, note bar, sustain, trails).
- `src/ui/ui-composite-looper.ts`: reusable quantized MIDI loop recorder widget (REC/CLR, 4-measure slots).
- `src/ui/fretboard.ts`: reusable fretboard UI object.
- `src/app/session-transport.ts`: shared transport/beat event bus used by Wild Tuna.
- `src/app/share-payloads.ts`: encode/decode/validate share URL payloads.
- `src/audio/worklet.ts`: tuner AudioWorklet pitch detection in audio thread.
- `public/index.html` + `public/style.css`: static UI structure and style entry point.
- `public/styles/`: ordered CSS files (00-foundation through 80-key-finder).

## Mode Model

Modes are represented by `ModeDefinition` (`src/modes/types.ts`):
- identity/display metadata (`id`, `title`)
- capabilities (`preserveState`, `canFullscreen`)
- lifecycle callbacks (`onEnter`, `onExit`)

`src/main.ts` owns switching and calls lifecycle hooks through `runModeTransition`.

## UI Decisions (Current)

- Mode switching UI is the mode chip picker; bottom icon bar is removed.
- Drum Machine and Wild Tuna both support fullscreen.
- Drum Machine grid is fixed at 16 steps (4/4 layout only).
- Circle of Fifths uses angular CW/CCW tap zones per wedge — no chord-mode state, no zoom.
- Wild Tuna looper has REC + CLR buttons; no PLAY button.

## Background Randomness Contracts (Current)

- Tuner: mapped from detune with smoothing/decay behavior.
- Metronome: frame-updated time/beat curve behavior.
- Drum Machine: beat-boundary jump behavior only.
  - Only beats that contain at least one active step can update randomness.
  - First sounding beat of each bar is always `0`.
  - Later sounding beats linearly progress by sounding-beat rank to the configured target.

## Testing Strategy

- Unit tests (`tests/unit/`): pure logic — looper state machine, share payloads, session transport, fretboard logic, key-finder logic, circle tap zones.
- E2E tests (`tests/`): Playwright cross-browser UX/regression coverage.

Do not add runtime test flags/globals in production flow when tests can cover behavior externally or via pure helpers.

## Build and Run

- `npm run dev`
- `npm run build`
- `npm run typecheck`
- `npx vitest run` (unit tests)
- `npx playwright test` (E2E)

## No-Bush Maintenance Rule

Favor readability over legacy compatibility shims.

For each feature/refactor, actively prune:
1. Unused functions, selectors, constants, and code paths.
2. Dead DOM/CSS tied to removed UI patterns.
3. Obsolete mode abstractions that no longer match product decisions.
4. Test-only runtime branches that leak into app logic.

If behavior shape changes, update comments and AGENTS docs in the same change.
