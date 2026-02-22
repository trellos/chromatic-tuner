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

## Testing expectations
- Keep assertions deterministic (text, selected state, counts, visibility).
- Cover interaction flow in Playwright with at least desktop and mobile projects.
- Avoid test-only branches in runtime code.
