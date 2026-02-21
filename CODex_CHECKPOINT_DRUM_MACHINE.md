# Codex Handoff Checkpoint: Drum Machine Randomness

Date: 2026-02-21

## Current objective status
- Drum Machine now drives seigaiha randomness while active.
- Randomness updates are beat-gated and step-pattern-aware.
- Debug control now includes a drum target parameter (`TG`) in the shared seigaiha panel.
- First sounding beat behavior has been finalized: it starts at `0`.

## Current implementation (important)
### `src/modes/drum-machine.ts`
- Mode accepts options:
  - `onRandomnessChange?: (randomness: number | null) => void`
  - `getRandomnessTarget?: () => number`
- Randomness logic:
  - updates only at beat boundaries,
  - can update only when that beat window contains at least one active step,
  - first sounding beat in bar emits `0`,
  - later sounding beats rise linearly by sounding-beat rank,
  - final sounding beat reaches `target`.
- Bar/transport behavior:
  - transport start forces randomness `0`,
  - bar start forces randomness `0`,
  - transport stop forces randomness `0`,
  - mode exit emits `null` to release mode override.
- New helper behavior:
  - `beatContainsAnySound(...)` checks if a beat window has any enabled step.
  - `getSoundingBeatIndices(...)` builds ordered sounding beats for rank-based interpolation.

### `src/main.ts`
- Drum mode is wired with:
  - `onRandomnessChange -> setSeigaihaModeRandomness(...)`
  - `getRandomnessTarget -> drumRandomnessTarget`
- Added drum randomness target state:
  - default `0.9`,
  - clamped `0..1`.
- Debug panel (`?debug=1`) now includes a mode-scoped drum section:
  - subtitle `Drum params`,
  - numeric input `#seigaiha-drum-target`,
  - short label `TG`.

### `tests/ui.spec.ts`
- Added drum debug visibility test:
  - `seigaiha debug shows drum target only in drum machine mode`
- Existing drum-focused UI suite still passes after wiring changes.

### AGENTS documentation updates
- `.github/AGENTS.md` updated with app-level randomness contracts and drum debug note.
- `src/modes/AGENTS.md` updated with finalized drum background contract.
- `src/ui/AGENTS.md` updated with mode priority and drum debug section docs.

## User behavior contract to preserve
1. Randomness changes on beat boundaries (not per-frame smoothing).
2. Beat must contain at least one sound to update randomness.
3. First sounding beat of a bar is always `0`.
4. Progression to target is linear across sounding beats.
5. Target is debug-tunable (`TG`), default `0.9`.

## Validation run summary
- `npm run build` passed.
- `npx playwright test tests/ui.spec.ts --grep "seigaiha debug"` passed.
- `npx playwright test tests/ui.spec.ts --grep "drum machine"` passed.

## Practical next-step options
1. Add targeted unit tests for sounding-beat rank interpolation edge cases.
2. Add an end-to-end assertion for first-sounding-beat randomness = `0`.
3. Decide whether target should persist across reloads (currently in-memory debug state).

