# UI Directory Guide

This file describes how `src/ui` modules should be designed and maintained as this directory grows.

## Directory Intent

`src/ui` is for reusable UI-level presentation logic that is shared across modes or app-wide surfaces.

Current entry:
- `seigaihaBackground.ts`: app background pattern generation + install/update API.

Future entries should follow the same principles:
- module owns its own rendering/state concerns,
- exposes small integration APIs to callers,
- avoids mode-specific business logic.

## Build / Runtime Audio Prerequisite

- UI validation in metronome/drum contexts assumes `public/assets/audio/**/*.wav` is hydrated from Git LFS.
- `npm run build` and `npm run dev` enforce this via `scripts/verify-audio-assets.mjs` (including one auto-hydration attempt via `git lfs pull --include="public/assets/audio/**"`); if that check still fails, hydrate/fix LFS in the runner before retrying.

## Integration Expectations

- `src/main.ts` should wire UI modules into app lifecycle.
- `public/style.css` should carry supporting CSS primitives for these modules.
- UI modules should be deterministic and testable when possible.

## Current Module Notes: Seigaiha Background

Primary implementation:
- `src/ui/seigaihaBackground.ts`

Integration points:
- `src/main.ts` (mode callbacks, debug controls, and state wiring)
- `public/style.css` (`body::before` pattern layer + gradient mood layer)

### Artistic Intent

- Traditional seigaiha readability first.
- One background pattern layer only (no multi-layer/parallax clutter).
- Opaque, clean wave bands (not sketchy/translucent strokes).
- Slight overlap between neighboring waves.
- Row nesting should feel tucked into the overlap region of the row below.
- Keep the strong atmospheric gradient behind the pattern.

At low randomness, pattern should read like textbook seigaiha.
At high randomness, pattern should feel organic but still recognizably seigaiha.

### Seigaiha Invariants

1. `randomness` is normalized `0..1`.
2. `randomness = 0` means no variation:
   - consistent radius,
   - textbook spacing,
   - no accent color overlays.
3. Randomness effects are deterministic for a fixed seed.
4. Wave shrink is allowed; upper-row vertical placement is not jittered by randomness.
5. Smaller waves should pull horizontal neighbors inward.
6. Color variation is per-band (independent by band), not whole-wave only.
7. Accent color transition must fade in gradually with randomness (avoid hard threshold pops).
8. Background remains a single CSS `url(...)` image layer.

### Seigaiha Geometry / Tiling Rules

- Keep pattern generation tile-safe (no visible seams on repeat).
- If using randomness, keep periodic structure aligned to tile periods.
- Preserve wave draw ordering (right-to-left per row) so corner overlap feels woven.
- Preserve row paint ordering (top-to-bottom) so lower rows read in front.

### Seigaiha State / Debug Rules

- Background randomness source of truth is state in `seigaihaBackground.ts`.
- Mode priority:
  - debug override (if enabled),
  - mode-driven randomness (metronome or drum machine),
  - tuner detune mapping/smoothing.
- Tuner randomness is mapped from absolute cents with interpolation and decays to `0` when no note is detected.
- Tuner visual randomness smoothing runs on RAF for smoother motion between pitch updates.
- Debug UI is gated behind `?debug=1` and mode-scoped:
  - tuner: override toggle/slider, effective FPS, smoothing input, detune mapping table.
  - metronome: compact parameter table (`NA`, `I44`, `I34`, `I68`, `UP`, `DN`).
  - drum machine: target input (`TG`) for beat-progression ceiling (`0..1`, default `0.9`).

### Seigaiha Change Checklist

When editing this system:
1. Verify `tests/ui.spec.ts` seigaiha test still passes.
2. Manually check `randomness` at `0`, `~0.3`, `~0.7`, and `1.0`.
3. Confirm no obvious seam artifacts at tile boundaries.
4. Confirm the pattern still reads as traditional seigaiha from a distance.
5. Confirm debug sections switch correctly per active mode.

### Seigaiha Anti-Patterns

- Adding extra background layers to fake depth.
- Random per-frame animation/flicker in the pattern.
- Non-deterministic randomness that changes between renders.
- Making color changes all-at-once across a whole wave when per-band independence is desired.
