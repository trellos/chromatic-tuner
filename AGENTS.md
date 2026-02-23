# Repository Guide

## Core workflow
- Install: `npm ci`
- Typecheck: `npm run typecheck`
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
  - while in chord mode, tapping any outer wedge plays that wedge's major triad and does not change primary
  - chord mode exits only when tapping SVG background (outside wedges)
- Inner detail rotation should always follow shortest angular path when primary changes.
- Chord MIDI generation must keep the chord root as the first/lowest note and normalize octave consistently.

## Testing expectations
- Keep assertions deterministic (text, selected state, counts, visibility).
- Cover interaction flow in Playwright with at least desktop and mobile projects.
- Avoid test-only branches in runtime code.
