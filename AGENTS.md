# Repository Guide

## Core workflow
- Install: `npm ci`
- Typecheck: `npm run typecheck`
- CSS lint: `npm run lint:css`
- CSS autofix: `npm run lint:css:fix`
- E2E: `npm run test:e2e`
- Dev server: `npm run dev`

## Mode architecture
- Mode registration and lifecycle switching live in `src/main.ts`.
- Mode contracts are defined in `src/modes/types.ts`.
- Each mode module should export a `create*Mode()` factory that returns a `ModeDefinition`.
- Keep mode-specific music/state logic in pure helpers when possible, and keep DOM wiring inside mode factories.

## Fretboard mode notes
- Entry point: `src/modes/fretboard.ts`.
- Pure theory/render helpers: `src/modes/fretboard-logic.ts`.
- UI markup and styles: `public/index.html` + `public/style.css`.
- Default state is **C Major scale** in notes view.
- Open-string membership is shown as small hollow indicators above strings.
- In mobile portrait, keep fretboard + controls visible together without internal panel scrolling.
- Chord aliases are normalized in helper logic (for example `sus4` and `Suspended Fourth`).

## Circle of Fifths notes
- Shared UI implementation: `src/ui/circle-of-fifths.ts`.
- Dedicated mode adapter: `src/modes/circle-of-fifths.ts`.
- Outer ring has 12 primary wedges in circle-of-fifths order.
- Detail layer has 2 inner rings:
  - middle: three minor wedges (`ii`, `iii`, `vi`)
  - inner: one diminished wedge (`vii°`)
- Chord mode flow:
  - first tap on a primary note sets primary and plays single note
  - tapping the same primary note again enters chord mode and plays that primary major triad
  - if the retap is a primary double tap, chord mode zooms to that primary cluster while keeping I/IV/V and inner detail wedges visible
  - while in chord mode, tapping any outer wedge plays that wedge's major triad and does not change primary
  - chord mode exits only when tapping outside the circle radius (not just outside wedges)
- Exiting chord mode restores full-circle zoom.
- When a primary note is selected, note-bar rows show bold uppercase roman numerals in a left column beside each diatonic note square.
- Double-tapping SVG background inside the circle cycles instruments and updates the inner indicator text.
- Holding a circle wedge sustains playback while pressed, then releases on pointer end/cancel/leave.
- Note-bar notes follow the same press lifecycle as wedges: sound starts on pointer down and ends on pointer up/cancel/leave.
- Sustained playback uses looped sample regions derived from zero-crossing loop points per instrument sample.
- Note-bar trail behavior:
  - each played note spawns a separate trail object under the note square
  - while held/sounding, trail stretch keeps its right edge pinned under the note square and extends left at a constant velocity
  - on release/end, that same trail keeps its width and both edges move left at the same velocity (about 2 seconds across the circle)
  - repeated note/chord pulses stack trails instead of replacing them, so rhythmic gaps remain visible between trails
  - roman numeral degree labels never animate with the trail
- Rapid double-taps on the same target are debounced to prevent a second short re-attack.
- Circle instrument set:
  - `ACOUSTIC GUITAR`
  - `ELECTRIC GUITAR`
  - `SPANISH GUITAR`
  - `PIPE ORGAN`
  - `HOUSE ORGAN`
- Inner detail rotation should always follow shortest angular path when primary changes.
- Chord MIDI generation must keep the chord root as the first/lowest note and normalize octave consistently.

## Testing expectations
- Keep assertions deterministic (text, selected state, counts, visibility).
- Cover interaction flow in Playwright with at least desktop and mobile projects.
- Avoid test-only branches in runtime code.

## CSS maintainability
- CSS lint rules are defined in `.stylelintrc.cjs`.
- Keep drift low by running `npm run lint:css:fix` on style edits.
- Property order is enforced (`stylelint-order`) to keep diffs deterministic.
- Styles are split into ordered files under `public/styles/` and imported via `public/style.css`; see `docs/CSS_MAINTENANCE.md`.

