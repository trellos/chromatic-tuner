# UI Directory Guide

This file describes how `src/ui` modules should be designed and maintained as this directory grows.

## Directory Intent

`src/ui` is for reusable UI-level presentation logic that is shared across modes or app-wide surfaces.

Current entries:
- `seigaihaBackground.ts`: app background pattern generation + install/update API.
- `drum-machine.ts`: reusable drum machine UI object (lifecycle + transport).
- `circle-of-fifths.ts`: reusable Circle of Fifths shell (tap zones, geometry, detail orchestration).
- `circle-note-bar.ts`: reusable Circle note-bar surface (rows, pointer lifecycle, sustain trails).
- `fretboard.ts`: reusable fretboard UI object.
- `ui-composite-looper.ts`: reusable quantized MIDI loop recorder widget (REC/CLR, 4-measure slots).

Modules should:
- own their own rendering/state concerns,
- expose small integration APIs to callers,
- avoid mode-specific business logic.

## Integration Expectations

- `src/main.ts` should wire UI modules into app lifecycle.
- `public/style.css` should carry supporting CSS primitives for these modules.
- UI modules should be deterministic and testable when possible.

## Module Boundaries (do not cross)

- Do NOT create `new AudioContext()` inside any `src/ui/` module. Always use `src/app/audio-context-service.ts`.
- Do NOT import from `src/modes/`. UI modules are upstream of modes, never downstream.
- Do NOT embed transport coordination logic (beat scheduling, looper arming, BPM math) — expose callbacks for callers to implement.

## `jam-flow.ts` note

`src/ui/jam-flow.ts` is a multi-view canvas rendering module. All three views (Circle, Key Zoom, Fretboard)
share one `<canvas>` and one RAF loop, and the animated transitions between views interpolate positions
across all three simultaneously. This is intentionally one file. Its size (>1,500 lines) is a consequence
of legitimate complexity, not a refactoring target. Judge it by its public API (currently 6 methods), not by line count.

## Current Module Notes: Seigaiha Background

Primary implementation:
- `src/ui/seigaihaBackground.ts`

Integration points:
- `src/main.ts` (mode callbacks, debug controls, and state wiring)
- `public/style.css` (`.seigaiha-canvas` fixed render surface + gradient mood layer)

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
8. Background remains a single persistent fullscreen surface.

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

## Circle of Fifths UI (shared between tuner and dedicated mode)

Primary implementation:
- `src/ui/circle-of-fifths.ts`
- `src/ui/circle-note-bar.ts` (note-bar rows, trails, and pointerdown note lifecycle)

Integration points:
- `src/modes/tuner.ts` (Strobe/Circle toggle + pitch-driven primary updates)
- `src/modes/circle-of-fifths.ts` (standalone mode wrapper)
- `src/modes/wild-tuna.ts` (embedded circle with looper integration)
- `public/styles/60-circle-of-fifths.css` + `public/styles/61-circle-note-bar.css`

### Circle invariants

1. Outer ring is always rendered programmatically with 12 notes.
2. Inner detail wedges stay hidden until a primary note is set.
3. Detail layer has two inner rings:
   - middle ring: exactly three wedges (`ii`, `iii`, `vi`)
   - inner ring: exactly one wedge (`vii°`) for diminished chord
   - keep a visible geometric gap between these two rings (no edge contact).
4. Primary note change rotates the inner detail layer using shortest angular path; avoid long-way spins.
5. In tuner integration, no detected note means no primary and no inner wedges.
6. Tuner detune guidance maps signed cents into a bounded rotational offset centered at in-tune.
7. **Tap zone split (no chord mode toggle):**
   - Each outer wedge is split angularly: CCW 40% = note-only tap, CW 60% = chord tap.
   - CCW tap plays the single note; does not change the primary (inner circle) selection.
   - CW tap plays the major chord; moves the inner circle to that key (except IV/V which don't move primary).
   - IV/V CW taps play the chord without changing the primary.
   - Tap outside the circle clears the inner circle (no sound).
   - There is no separate chord mode state, no zoom, no double-tap entry.
8. Note bar degree badges:
   - when a primary is selected, each diatonic note row shows its roman numeral in a left column outside the note square.
   - roman numerals in the note bar should render as bold uppercase tokens (for example `III`, `VII°`).
   - note labels remain uppercase note names (not chord symbols).
   - note rectangles should remain visible across patterned backgrounds; lesser degrees (`ii`,`iii`,`vi`,`vii`) may be intentionally more muted than `I/IV/V`, but never near-invisible.
9. Instrument cycling:
   - a double-tap on SVG background inside the circle radius cycles circle playback instruments.
   - inner indicator text shows the active instrument name (for example `ELECTRIC GUITAR`, `PIPE ORGAN`).
10. Hold-to-sustain behavior:
    - CW zone pointer-down sustains major chord; pointer-up/cancel/leave stops sustain.
    - CCW zone pointer-down sustains single note; pointer-up/cancel/leave stops sustain.
    - Note-bar notes follow the same press lifecycle: sound starts on pointer down, ends on pointer up/cancel/leave.
11. Instrument label arc runs along the inner-circle boundary, always antipodal to the detail wedge group; rotates smoothly when the primary changes.
12. Note-bar cells expand leftward (`transform-origin: right center`) on press so they don't clip at the CoF edge.
13. Note-bar trail behavior:
    - each played note spawns a separate trail object under the note square.
    - while held/sounding, trail stretch keeps its right edge pinned under the note square and extends left at constant velocity.
    - on release/end, the trail keeps its width and both edges move left at the same velocity (~2s across the circle).
    - repeated note/chord pulses stack trails instead of replacing them.
    - roman numeral degree labels never animate with the trail.
14. Rapid double-taps on the same target are debounced to prevent a second short re-attack.
15. Chord MIDI generation must keep the chord root as the first/lowest note and normalize octave consistently.
16. Keep Circle rendering shared in `src/ui/circle-of-fifths.ts`; mode files should stay as lifecycle/adapters.
   - in chord mode, inner/background double-tap must not exit chord mode or cancel zoom.
17. Chord zoom safety:
   - zoom target should keep the primary harmonic cluster (`I`, `IV`, `V`, `ii`, `iii`, `vi`, `vii°`) visible within the SVG viewport.
18. Playback responsiveness is a hard requirement:
   - note/chord onset is part of instrument feel, not just visual confirmation.
   - outer wedge and note-bar playback should fire immediately on pointer-down for touch/pen/mouse.
   - avoid intentional single-tap delay windows for click-vs-dblclick arbitration on audio-trigger paths.

### Circle test expectations

- Verify deterministic note/chord labels and visible-state toggles.
- Cover at least one desktop and one mobile viewport in Playwright for layout visibility.
- Prefer class/visibility/count assertions over pixel snapshots.
- Verify CCW/CW tap zone behavior: CCW plays single note (no primary change), CW plays chord (primary moves except IV/V).
- Verify rapid double-tap on the same note/chord does not trigger duplicate short re-attacks.
- Verify note-bar roman numeral badges for at least one selected key.
- Verify inner-circle background double-tap cycles instrument indicator text deterministically.
- Verify wedge pointer hold toggles the holding lifecycle state (`is-holding`) deterministically.
- Verify pointer-down triggers playback state before pointer-up on both touch-like and mouse-like inputs.

## Drum Machine UI (shared object)

Primary implementation:
- `src/ui/drum-machine.ts`

Integration points:
- `src/modes/drum-machine.ts` (mode adapter)
- `src/modes/wild-tuna.ts` (embedded in Wild Tuna layout)
- `src/main.ts` (`window.__tunaUiObjects` exposure for coexistence testing)

### Drum invariants

1. UI object must be reusable and lifecycle-driven (`enter`, `exit`, `destroy`).
2. Transport and scheduling behavior must match existing mode behavior.
3. Share/hydration contract (`track` base64url payload) must remain deterministic.
4. Randomness callback emits `null` on exit and bounded `0..1` values while active.

### Count-in

- `countIn(onComplete)` plays a 4-beat woodblock count-in at current BPM using Web Audio API.
- On completion: calls `onComplete()` synchronously, then starts transport asynchronously (`await ensureAudio()`).
- Visual: `is-count-in` + `is-count-in-beat` classes on `drumMockEl` for CSS animation.
- Should only be called when transport is stopped (`isPlaying === false`).
- Used by Wild Tuna coordinator when REC is pressed with transport stopped.

### Wild Tuna integration notes

- Wild Tuna passes `onShareOverride` to replace the drum machine's default share URL behavior.
- Wild Tuna serializes the full session (drum pattern + loop MIDI data) via `getTrackPayload()` / `loadTrackPayload()`.
- Wild Tuna tracks global measure position externally via `onBeatBoundary`; the drum machine does not own measure-level timing for loopers.

## Composite Looper UI

Primary implementation:
- `src/ui/ui-composite-looper.ts`

Integration points:
- `src/modes/wild-tuna.ts` (two instances: circle looper + fretboard looper)

### What it does

A self-contained REC/CLR widget that records and plays back quantized MIDI events
synchronized to an external transport (the drum machine). Each instance manages:
- A REC button (arms → records → stops) and a CLR button (wipes loop). No PLAY button.
- Up to `MAX_MEASURES` (4) of recorded measure slots (growable per pass).
- Quantization: note events are snapped to 16 steps per measure.
- Playback: scheduled via `setTimeout` relative to `performance.now()`.

### State machine

```
idle ──[REC press]──→ armed ──[measure boundary]──→ recording
                                                         │
                      idle ←──[measure boundary]── stopping ←──[REC press or MAX_MEASURES reached]
```

`requestArm()` transitions `idle → armed` externally (called by the coordinator).
`requestStop()` transitions `recording → stopping` externally.

### API contract

- `onTransportStart()` / `onTransportStop()`: called by mode when drum transport changes.
  - **`onTransportStart()` is a no-op when `recordState === "armed" || "recording"`** to prevent resetting `currentMeasureStartPerfMs` after the count-in arm path has already set up recording state.
- `onBeatBoundary(event)`: drives state machine; measure boundary is `beatIndex === 0`.
- `recordPulse(midis, durationMs)`: records a short tap event (e.g. circle tap).
- `recordHoldStart(sourceId, midis)` / `recordHoldEnd(sourceId)`: records a sustained hold.
- `requestArm()`: clears previous loop + arms for recording; pre-sets `isTransportPlaying = true` so count-in beat boundaries aren't dropped (arm fires before `onTransportStart` in count-in path).
- `loadLoop(slots)`: hydrates looper with saved slot data (from share URL).
- `getMeasureSlots()`: returns deep-copy of recorded slots for serialization.
- `seekToMeasure(index)`: schedules a playback-head jump at next measure boundary. Sets a `recordingSeekTarget` (separate from `pendingSeekMeasure`) that survives count-in beat boundaries and is consumed only by `requestArm()`.

### Key implementation details

- **`playbackMeasureIndex` sentinel:** initialized to `-1`; reset to `-1` in `onTransportStart()` and `onTransportStop()`. First measure boundary always produces `(-1+1) % effectiveCount = 0`, guaranteeing playback starts at measure 0 without a separate boolean flag.
- **`preArmBuffer`:** notes played between `requestArm()` and the first beat boundary are buffered as `{ midis, durationMs }`. Flushed into slot 0 when recording begins. Pulses (`durationMs > 0`) schedule an auto-close timeout after flush. Holds (`durationMs === 0`) stay open until `recordHoldEnd` fires.
- **Count-in ordering:** `requestArm()` fires synchronously; `onTransportStart()` fires later (async `ensureAudio()`). The `onTransportStart` guard prevents clobbering `currentMeasureStartPerfMs` if a beat boundary already set it.

### Composite Looper test expectations

- Unit tests in `tests/unit/ui-composite-looper.test.ts` using `vi.useFakeTimers()`.
- Verify 4-measure recording stores all 4 slots and plays them back in order (0, 1, 2, 3, 0...).
- Verify `onTransportStart()` after `requestArm()` (count-in path) does not clobber measure-0 recording.
- Verify pre-arm buffer notes land in slot 0 at step 0.
- Verify measure-0 notes are not silently dropped when `onTransportStart` fires mid-measure.
- Verify CLR wipes slots and resets to idle.
- Verify `seekToMeasure()` jumps playback head at the next boundary.
