Refactor drum/circle into reusable UI objects and harden cross-browser e2e coverage

- extract Drum Machine runtime into shared UI object createDrumMachineUi(...) in src/ui/drum-machine.ts with lifecycle (enter/exit/destroy)
- convert src/modes/drum-machine.ts to a thin adapter over shared Drum UI object while preserving behavior and randomness helpers
- expose reusable UI factories in src/main.ts via window.__tunaUiObjects for coexistence wiring/tests (createCircleOfFifthsUi, createDrumMachineUi)
- update UI docs in src/ui/AGENTS.md for Drum UI object integration points and invariants
- expand Circle tests in tests/circle-of-fifths.spec.ts (indicator animation + note-bar keyboard activation)
- add dedicated Drum e2e coverage in tests/drum-machine.spec.ts
- add coexistence test in tests/ui-object-coexistence.spec.ts for Drum + Circle on one surface
- extract shared debug helper to tests/helpers/debug.ts and reuse from specs
- harden flaky cross-engine assertions in tests/ui.spec.ts and tests/fretboard.spec.ts

Validation:
- npm run typecheck passed
- npm run test:e2e passed (298 passed, 22 skipped)
