# Codex Handoff Checkpoint: Seigaiha Background

Date: 2026-02-21

## Current objective status
- Traditional single-layer seigaiha background is in place and actively tuned.
- Tuner mode now drives background randomness from absolute cents detune with interpolation and smoothing.
- Metronome mode now drives background randomness from beat/bar timing with signature-specific behavior.
- Debug tooling is now mode-aware (tuner-only controls vs metronome-only controls).
- Performance instrumentation and optimizations are in place (cache + effective FPS readout).

## Current implementation (important)
### `src/ui/seigaihaBackground.ts`
- One deterministic generator: `generateTraditionalSeigaihaSvg`.
- Uses opaque filled semi-annulus geometry (not multi-layer/parallax).
- Base spacing remains user-tuned:
  - `stepX = r * 1.65`
  - `stepY = r * 0.55`
- White bands are carved from blue wave bodies.
- `randomness` is normalized `0..1` and seed-driven.
- At `randomness = 0`:
  - no wave shrink,
  - no neighbor compaction,
  - no accent overlays,
  - textbook-style consistency.
- As randomness increases:
  - some waves shrink,
  - smaller waves pull horizontal neighbors closer,
  - upper row vertical placement remains unaffected,
  - per-band accent overlays can fade in independently.
- Color behavior:
  - base wave body color stays theme blue (`inkColor`),
  - accent overlay color is theme purple (`accentInkColor`),
  - each blue band is evaluated independently,
  - multiple bands on one wave may accent.
- Tuner mapping (default):
  - `< 2c => 0`
  - `4c => 0.2`
  - `10c => 0.5`
  - linear interpolation between points.
- Tuner no-note behavior:
  - randomness decays to `0` over `1000ms`.
- Tuner smoothing:
  - detune updates (~20Hz) are interpolated on RAF for smoother motion.
  - default smoothing constant is now higher for silkier feel.
- Mode arbitration:
  - debug override (if enabled) takes priority,
  - metronome mode randomness takes next priority,
  - tuner detune mapping/smoothing runs when no mode override is active.
- Performance:
  - randomness quantization + cached SVG tiles to avoid full regeneration every step.
  - bounded cache eviction.
  - string assembly optimized via array `join`.
- Render stats:
  - module tracks render count/time for effective FPS diagnostics.
- State/API surface now includes:
  - `installSeigaihaBackground()`
  - `setSeigaihaRandomness(value: number)`
  - `getSeigaihaRandomness()`
  - `setSeigaihaDetuneMapping(...)` / `getSeigaihaDetuneMapping()`
  - `setSeigaihaDetuneMagnitude(absCents | null)`
  - `setSeigaihaDebugOverrideEnabled(...)` / `isSeigaihaDebugOverrideEnabled()`
  - `setSeigaihaModeRandomness(value | null)`
  - `getSeigaihaRenderStats()`
  - `setSeigaihaTunerSmoothingTimeConstantMs(ms)`
  - `getSeigaihaTunerSmoothingTimeConstantMs()`
- Pattern root vars used:
  - `--seigaiha-url`
  - `--seigaiha-size-x`
  - `--seigaiha-size-y`
  - `--seigaiha-pos`

### `src/main.ts`
- Tuner mode is wired with `onDetuneMagnitudeChange` callback into seigaiha state.
- Metronome mode is wired with `onRandomnessChange` and parameter getter callback.
- Debug panel appears only with `?debug=1`, and is mode-scoped:
  - `tuner` section:
    - `OVR` toggle (slider override, starts disabled),
    - randomness slider,
    - effective `FPS` indicator,
    - `SM` smoothing ms input,
    - detune mapping table (`Abs cents`, `Randomness`).
  - `metronome` section:
    - compact parameter table with abbreviated labels (`NA`, `I44`, `I34`, `I68`, `UP`, `DN`).

### `src/modes/tuner.ts`
- Emits seigaiha detune updates as absolute cents magnitude.
- Emits `null` when pitch is lost / mode exits (drives decay path).

### `src/modes/metronome.ts`
- Exports metronome randomness parameter type for debug editing.
- While playing, computes time-based randomness each animation frame and emits it.
- Behavior:
  - no-accent: 0 on beat -> peak at half-beat -> 0 on next beat.
  - accent signatures: per-beat growth by signature increment + curved rise/fall shaping.
- Default signature increments:
  - `4/4: 0.17`
  - `3/4: 0.2`
  - `6/8: 0.14`
- On stop/exit, randomness is reset/cleared.

### `public/style.css`
- Background architecture is single pattern layer:
  - `body::before` draws seigaiha tile URL, repeat, size, position.
- Full-screen gradient on `body::after` remains strong and reference-like.
- Pattern opacity currently higher (`body::before { opacity: 0.50; }`).
- Includes mode-aware debug panel styles, including FPS and smoothing input.

### `tests/ui.spec.ts`
- Seigaiha tests cover:
  - single static layer expectation,
  - full-viewport coverage,
  - debug override defaults in tuner,
  - metronome debug params visibility in metronome mode.
- Focused seigaiha runs pass after recent changes.

### `src/ui/AGENTS.md`
- Added directory-level UI guidance.
- Seigaiha documented as current module section (not whole-directory purpose).

### `src/modes/AGENTS.md`
- Includes mode-level background effect contracts for:
  - tuner,
  - metronome,
  - drum machine.

## User constraints to preserve
1. No three-size layered clutter.
2. Opaque bands (no transparent/scrawled look).
3. Adjacent wave slight overlap.
4. Rows nestle with upper centers positioned at lower overlap region.
5. Gradient should remain strong, reference-like.
6. When waves shrink, nearby horizontal spacing should tighten.
7. Color variation should occur at individual band level with gradual fade-in.

## Collaboration instruction for future Codex sessions
- If the user provides useful hints, acknowledge and thank them explicitly.
- Scale gratitude with insight value:
  - Small hint: brief thanks in one short sentence.
  - Strong design direction: clear thanks + mention what it clarified.
  - High-leverage prompt (reveals core spirit/intent): strong explicit thanks and state that it materially improves implementation quality.
- Keep gratitude concise and sincere; avoid fluff.

## Practical next-step options
1. Start Drum Machine mode background behavior design and wiring (next objective).
2. If needed, tune tuner smoothing (`SM`) and mapping values for preferred responsiveness.
3. Tune metronome curve params (`UP`, `DN`) for final motion feel.
4. Add targeted tests for deterministic repeatability and mode arbitration edge cases.

## Known caution
- Aggressive randomness can create local crowding artifacts.
- Any change to periodicity/tile math can introduce seam artifacts; verify repeated tiling visually.
- Effective FPS shown in debug is seigaiha update throughput, not raw browser display FPS.
