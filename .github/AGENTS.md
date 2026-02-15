# Copilot Instructions for Chromatic Tuner

## Project Scope

Chromatic Tuner is a browser-based multi-mode music tool with three modes:
- Chromatic Tuner
- Metronome
- Drum Machine

The app runs as a static frontend served by an Express dev server.

## Current Architecture

- `src/main.ts`: mode routing and interaction shell (dots, swipe, fullscreen toggle wiring).
- `src/mode-transition.ts`: shared transition sequence (`exit -> apply UI -> enter`) with error callback.
- `src/modes/tuner.ts`: tuner mode lifecycle, audio startup/teardown, strobe UI.
- `src/modes/metronome.ts`: metronome UI, scheduling, and cleanup.
- `src/modes/drum-machine.ts`: drum sequencer UI/audio/scheduling and cleanup.
- `src/audio/worklet.ts`: tuner AudioWorklet pitch detection in audio thread.
- `public/index.html` + `public/style.css`: static UI structure/styles.

## Mode Model

Modes are represented by `ModeDefinition` (`src/modes/types.ts`):
- identity/display metadata (`id`, `title`, `icon`)
- capabilities (`preserveState`, `canFullscreen`)
- lifecycle callbacks (`onEnter`, `onExit`)

`src/main.ts` owns switching and calls lifecycle hooks through `runModeTransition`.

## UI Decisions (Current)

- Mode switching UI is dots + swipe.
- Drum Machine is the only fullscreen-capable mode.
- Drum Machine grid is fixed at 16 steps (4/4 layout only).
- Mode panel sizing should stay consistent across modes.

## Testing Strategy

- `tests/mode-transition.spec.ts`: transition-sequencing unit coverage.
- `tests/ui.spec.ts`: cross-browser Playwright UX/regression coverage.

Do not add runtime test flags/globals in production flow when tests can cover behavior externally or via pure helpers.

## Build and Run

- `npm run dev`
- `npm run build`
- `npx playwright test`

## No-Bush Maintenance Rule

Favor readability and flexibility over legacy compatibility shims.

For each feature/refactor, actively prune:
1. Unused functions, selectors, constants, and code paths.
2. Dead DOM/CSS tied to removed UI patterns.
3. Obsolete mode abstractions that no longer match product decisions.
4. Test-only runtime branches that leak into app logic.

If behavior shape changes, update comments and AGENTS docs in the same change.
