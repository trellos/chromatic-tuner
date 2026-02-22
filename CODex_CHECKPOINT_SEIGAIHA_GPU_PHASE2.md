# Codex Checkpoint: Seigaiha GPU Path (Phase 2 Kickoff)

Date: 2026-02-21  
Repo: `c:\dev\chromatic-tuner`

## Current Status
1. Phase 0 telemetry and Phase 1 two-frame interpolation were implemented.
2. Functional issue remains: visible metronome-time flicker is still present.
3. Root cause identified: high-frequency CSS `background-image` source churn on fullscreen pseudo-elements, not just SVG cache misses.

## Confirmed Root Cause
1. Metronome drives randomness every RAF (`src/modes/metronome.ts`).
2. Seigaiha pipeline still performs frequent large background source swaps (`data:image/svg+xml`) on fullscreen layers.
3. Even with cache hits, browser repaint/compositing churn causes persistent flicker.

## Tests Added For Rewrite Safety
Added to `tests/ui.spec.ts`:
1. `seigaiha debug telemetry stays visible with finite values across all modes`
2. `seigaiha telemetry remains finite while metronome drives continuous randomness`

These passed on Chromium Playwright.

## Existing Relevant Tests To Keep Passing
1. `tests/ui.spec.ts`
   - `metronome time-signature change resets seigaiha phase to bar start`
   - `drum mode randomness resets on start/stop and rises during playback`
   - `seigaiha background: single static traditional layer` (likely needs adaptation for new renderer backend)
2. `tests/seigaiha-mode-arbitration.spec.ts`
3. `tests/seigaihaBackground.spec.ts` (cache/interpolation math contracts)

## Decision For Next Iteration
Move seigaiha rendering off CSS background URL swapping and onto a GPU-oriented renderer path (WebGL first).

## Proposed GPU Phase 2 Scope (Fresh Chat)
1. Introduce a dedicated seigaiha render backend module (WebGL).
2. Render to a persistent fullscreen surface behind the app.
3. Keep the existing randomness driver/arbitration API unchanged.
4. Preserve two-frame interpolation semantics (`i0`, `i1`, `t`) but blend in GPU pipeline.
5. Keep bounded/lazy cache semantics for generated frame inputs/textures.
6. Add explicit graceful no-op fallback if WebGL context creation fails.
7. Update Playwright assertions that currently assume pseudo-element CSS background URLs.

## Constraints / Non-Goals
1. Do not regress mode behavior (tuner/metronome/drum randomness arbitration).
2. Do not block app functionality if renderer init fails.
3. Do not require full precompute of all frames.

## Suggested Next Prompt
"Continue from `CODex_CHECKPOINT_SEIGAIHA_GPU_PHASE2.md`. Implement a WebGL seigaiha renderer backend with persistent fullscreen surface, two-frame interpolation blend, bounded/lazy frame cache, graceful no-op fallback, and update tests accordingly."

