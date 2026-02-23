# UI Directory Guide

This file describes how `src/ui` modules should be designed and maintained as this directory grows.

## Directory Intent

`src/ui` is for reusable UI-level presentation logic that is shared across modes or app-wide surfaces.

Current entry:
- `seigaihaBackground.ts`: app background pattern generation + install/update API.
- `drum-machine.ts`: reusable drum machine UI object (lifecycle + transport).

Future entries should follow the same principles:
- module owns its own rendering/state concerns,
- exposes small integration APIs to callers,
- avoids mode-specific business logic.

## Integration Expectations

- `src/main.ts` should wire UI modules into app lifecycle.
- `public/style.css` should carry supporting CSS primitives for these modules.
- UI modules should be deterministic and testable when possible.

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

Integration points:
- `src/modes/tuner.ts` (Strobe/Circle toggle + pitch-driven primary updates)
- `src/modes/circle-of-fifths.ts` (standalone mode wrapper)
- `public/style.css` (`.cof-*` styles)

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
7. Roman numeral corner labels on outer wedges:
   - major mode: show `I`, `IV`, `V`
   - minor mode: show `III`, `VI`, `VII` (relative minor mapping)
8. Inner detail wedges should show corner roman numerals (`ii`, `iii`, `vi`, `vii°`) and center chord labels (`m` / `°`) while playback follows the selected key.
9. Keep Circle rendering shared in `src/ui/circle-of-fifths.ts`; mode files should stay as lifecycle/adapters.
10. Diminished chord labels should use the `°` symbol (for example `B°`) instead of the `dim` suffix.
11. Relative minor mode toggle:
   - entering: double-tap middle-ring `vi`
   - exiting: double-tap outer `III`
   - when active, outer roman labels and inner roman detail labels remap to relative minor degrees.
12. Chord-mode zoom:
   - entering chord mode from a primary double-tap should zoom viewBox toward that primary sector while keeping the I/IV/V and inner detail wedges in-frame.
   - exiting chord mode must restore the full-circle viewBox.
   - inner and outer rings must remain concentric while zoomed (same visual pivot center).
13. Note bar degree badges:
   - when a primary is selected, each diatonic note row shows its roman numeral in a left column outside the note square.
   - roman numerals in the note bar should render as bold uppercase tokens (for example `III`, `VII°`).
   - note labels remain uppercase note names (not chord symbols).
   - note rectangles should remain visible across patterned backgrounds; lesser degrees (`ii`,`iii`,`vi`,`vii`) may be intentionally more muted than `I/IV/V`, but never near-invisible.
14. Instrument cycling:
   - a double-tap on SVG background inside the circle radius cycles circle playback instruments.
   - inner indicator text shows the active instrument name (for example `ELECTRIC GUITAR`, `PIPE ORGAN`).
   - in chord mode, inner/background double-tap must not exit chord mode or cancel zoom.
15. Hold-to-sustain behavior:
   - pointer-down on an outer wedge starts sustain playback for that wedge role (note in note mode, major triad in chord mode).
   - pointer-down on inner detail wedges starts sustain playback for the selected chord.
   - pointer-up/cancel/leave stops sustain with a short release envelope.
16. Chord zoom safety:
   - zoom target should keep the primary harmonic cluster (`I`, `IV`, `V`, `ii`, `iii`, `vi`, `vii°`) visible within the SVG viewport.

### Circle test expectations

- Verify deterministic note/chord labels and visible-state toggles.
- Cover at least one desktop and one mobile viewport in Playwright for layout visibility.
- Prefer class/visibility/count assertions over pixel snapshots.
- Verify chord-mode enter/exit behavior:
  - retap primary enters chord mode and plays major triad
  - primary double-tap while in chord mode applies zoom-to-primary view
  - only taps outside the circle radius exit chord mode
  - chord-mode exit resets zoom to full-circle view
  - primary tap in chord mode plays major triad (does not exit)
- Verify rapid double-tap on the same note/chord does not trigger duplicate short re-attacks.
- Verify note-bar roman numeral badges for at least one selected key.
- Verify inner-circle background double-tap cycles instrument indicator text deterministically.
- Verify zoomed chord view does not clip the primary harmonic cluster in desktop and portrait mobile.
- Verify wedge pointer hold toggles the holding lifecycle state (`is-holding`) deterministically.

## Drum Machine UI (shared object)

Primary implementation:
- `src/ui/drum-machine.ts`

Integration points:
- `src/modes/drum-machine.ts` (mode adapter)
- `src/main.ts` (`window.__tunaUiObjects` exposure for coexistence testing)

### Drum invariants

1. UI object must be reusable and lifecycle-driven (`enter`, `exit`, `destroy`).
2. Transport and scheduling behavior must match existing mode behavior.
3. Share/hydration contract (`track` base64url payload) must remain deterministic.
4. Randomness callback emits `null` on exit and bounded `0..1` values while active.
