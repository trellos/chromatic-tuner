# Codex Handoff Checkpoint: Seigaiha Background

Date: 2026-02-21

## Current objective status
- Traditional single-layer seigaiha background is in place.
- Multiple iterations were done to match overlap/nesting and visual style.
- Current user-approved direction: keep geometry, next add controlled noise/variation.

## Current implementation (important)
### `src/ui/seigaihaBackground.ts`
- One deterministic generator: `generateTraditionalSeigaihaSvg`.
- Uses opaque filled semi-annulus geometry (not multi-layer parallax).
- Current spacing is user-tuned:
  - `stepX = r * 1.65`
  - `stepY = r * 0.55`
- White bands are currently carved from blue wave bodies.
- Pattern root vars used:
  - `--seigaiha-url`
  - `--seigaiha-size-x`
  - `--seigaiha-size-y`
  - `--seigaiha-pos`

### `public/style.css`
- Background architecture simplified to a single pattern layer:
  - `body::before` draws seigaiha tile URL, repeat, size, position.
- Full-screen gradient on `body::after` has been intensified to match reference mood.
- Pattern opacity currently set higher (`body::before { opacity: 0.50; }`).
- Card backdrop was made opaque earlier (`--panel`, `--panel-strong` are solid colors).

### `tests/ui.spec.ts`
- Seigaiha test currently expects single static layer.

## User constraints to preserve
1. No three-size layered clutter.
2. Opaque bands (no transparent/scrawled look).
3. Adjacent wave slight overlap.
4. Rows nestle with upper centers positioned at lower overlap region.
5. Gradient should remain strong, reference-like.

## Next task for new thread
- Add subtle "noise"/organic variation without breaking traditional readability.

## Suggested implementation plan for noise
1. Add deterministic noise parameter in `generateTraditionalSeigaihaSvg` (seeded hash).
2. Apply tiny per-wave perturbations:
   - radius jitter: ±1.5% to ±3%
   - optional tiny vertical jitter: ±0.5% to ±1%
3. Keep jitter consistent for all bands within each wave (preserve clean ring spacing).
4. Expose a single strength knob (`noiseAmount`) and keep default low (0.08-0.18 range).
5. Validate visually and with existing e2e test (should still pass since layer count remains 1).

## Known caution
- Excess jitter quickly creates corner artifacts with current aggressive spacing.
- Start very low and tune upward slowly.
