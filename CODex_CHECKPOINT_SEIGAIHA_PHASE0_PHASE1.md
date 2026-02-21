# Codex Checkpoint: Seigaiha Perf (Phase 0 -> Phase 4)

Date: 2026-02-21
Repo: `c:\dev\chromatic-tuner`

## Goal
Make seigaiha background animation visually smooth/fluid, target 60fps desktop performance, and keep mobile stable.

## What Was Already Fixed
1. Metronome measure reset bug on time-signature change was fixed.
2. Added regression test:
   - `tests/ui.spec.ts`
   - `metronome time-signature change resets seigaiha phase to bar start`
3. Seigaiha update path was optimized to avoid redundant installs when quantized randomness frame does not change.

## Key Product Decisions Made
1. Do not reduce frame resolution as the primary first move.
2. Do not precompute huge counts (256/512) due to memory risk, especially mobile.
3. Preferred direction:
   - Phase 0: measure/telemetry baseline first.
   - Phase 1: two-frame interpolation (crossfade between adjacent cached frames).

## Tradeoff Summary (Agreed)
1. Option 1 (pre-render frames + blend adjacent): best near-term value, lower risk.
2. Option 2 (canvas/atlas/blit): higher performance ceiling, much higher rewrite risk.
3. Option 3 (coarser quantization): good perf but reduces smoothness, not preferred for “fluid”.

## Proposed Execution Plan (Current)
### Phase 0: Baseline/Telemetry
Add lightweight instrumentation for:
1. `avgFPS`
2. `p95 frame time`
3. `max frame time`
4. seigaiha render swaps/sec
5. cache hit/miss stats

Run baseline captures:
1. Metronome 120 BPM, 4/4, 30s.
2. Drum machine playback, 30s.

### Phase 1: Two-Frame Crossfade
Implement interpolation between neighboring quantized frames:
1. Compute frame index from randomness.
2. Resolve floor/ceil frames (`i0`, `i1`) and fractional `t`.
3. Render both frames and blend opacities (`1-t`, `t`).
4. Use bounded/lazy caching (not full pre-render of all possible steps).

Initial tuning targets:
1. Desktop frame budget: around 96 logical steps.
2. Mobile fallback: around 48 steps.

### Phase 2: Adaptive Cache + Memory Budget
Goal: keep smoothness while preventing memory spikes.
1. Implement LRU frame cache with hard caps.
2. Suggested caps:
   - desktop: `maxFrames ~120`
   - mobile/low-memory: `maxFrames ~56`
3. Pin active neighborhood:
   - keep current `i0/i1` plus nearby frames (for example +/- 8).
4. Add adaptive quality profile using device/runtime hints.
5. Ensure cache warming is lazy, not full precompute.

Acceptance for Phase 2:
1. Cache hit rate > 90% after short warm period in metronome mode.
2. No memory-driven tab reloads in mobile runs.
3. No noticeable stutter when sweeping randomness across common ranges.

### Phase 3: Optional Smaller Tile Geometry
Goal: reduce per-frame raster/composite cost if Phase 1+2 are still short of target.
1. Prototype reduced tile profile (for example near `528x264` or `512x256`).
2. Retune geometry periods to keep seamless tiling.
3. Compare visual quality at randomness `0`, `0.3`, `0.7`, `1.0`.

Tradeoff notes:
1. Smaller tile lowers render cost and memory.
2. Repetition becomes more obvious; risk to traditional seigaiha readability.
3. Requires visual QA for seams and pattern authenticity.

Acceptance for Phase 3:
1. Additional frame-time reduction over Phase 2 baseline.
2. No seam artifacts.
3. Pattern still reads as traditional seigaiha.

### Phase 4: Worker Offload (If Needed)
Goal: remove remaining main-thread spikes from frame generation.
1. Move frame generation/prep to a worker.
2. Main thread handles only frame selection + opacity blending.
3. Keep deterministic output for same seed/options.

Tradeoff notes:
1. Better responsiveness under load.
2. Higher implementation complexity (messaging/lifecycle/fallbacks).

Acceptance for Phase 4:
1. Reduced long tasks on main thread.
2. Smoother UI/audio responsiveness during cache warm.
3. No regression across browser targets.

## Overall Acceptance Criteria
1. Desktop metronome run feels visually smooth (no obvious stepping).
2. `p95 frame time <= 16.7ms` in desktop stress pass.
3. Mobile stays stable (no crashes/reloads due to memory pressure).
4. Existing seigaiha/metronome/drum Playwright coverage continues to pass.

## Suggested Next Prompt For New Chat
"Continue from `CODex_CHECKPOINT_SEIGAIHA_PHASE0_PHASE1.md`. Implement Phase 0 telemetry first, then Phase 1 two-frame crossfade interpolation for seigaiha with bounded cache and tests. After that, proceed through Phase 2+ only if metrics show Phase 1 is insufficient."
