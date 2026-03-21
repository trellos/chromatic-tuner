# Repository Guide

## Core workflow
- Install: `npm ci`
- Typecheck: `npm run typecheck`
- CSS lint: `npm run lint:css`
- CSS autofix: `npm run lint:css:fix`
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
- Reusable UI object: `src/ui/fretboard.ts`.
- UI markup and styles: `public/index.html` + `public/style.css`.
- Default state is **C Major scale** in notes view.
- Open-string membership is shown as small hollow indicators above strings.
- In mobile portrait, keep fretboard + controls visible together without internal panel scrolling.
- Chord aliases are normalized in helper logic (for example `sus4` and `Suspended Fourth`).
- `HIDE` collapses all controls to a single summary button; no selector/action rows should remain visible while hidden.
- Hidden summary appears rotated near the high-E side of the board and restores controls on tap.
- `createFretboardUi` supports `setLooperElement(...)`; attached looper UI is rendered in the board looper slot (under the 12th-fret area), not over the controls.
- Fretboard zoom: `TARGET` arms a one-shot zoom, and the next tapped note zooms to a 3-string / 4-fret window around that note with a slight overscan (~half fret/string) for context.
- Zoom exits when tapping outside the board or pressing Escape.
- In Extra Jimmy, toggling the shared `TARGET` button off clears zoom on both boards.

## Navigation notes
- Bottom mode icon bar is removed; mode switching is via the mode chip picker only.

## Key Finder mode notes
- Entry point: `src/modes/key-finder.ts`.
- Pure scoring/normalization logic: `src/modes/key-finder-logic.ts` (must stay UI-independent).
- UI markup/styles: `public/index.html` + `public/styles/80-key-finder.css` (imported via `public/style.css`).
- Input is 12 note toggles only (no fretboard tab in this mode).
- The note grid keeps a tall `Clear` button aligned to the right of both rows.
- Candidate rows should stay compact: key label + scale notes (no confidence progress bar).
- In candidate scale note text, selected notes are visually emphasized; non-diatonic notes appear inline in parentheses as `non-diatonic`.
- Candidate cards use a seigaiha-style colorful background; randomness increases as confidence drops (`100% => 0`, `66% => 0.3`) and must affect texture/noise only (no card tilt/rotation), with visible seigaiha arcs filling the card interior.
- Tapping a candidate row updates a separate one-line hint listing related modal interpretations (the row itself should not expand).

## Circle of Fifths notes
- Shared Circle playback adapter: `src/app/circle-audio-controller.ts` (maps direct surface interactions onto the shared audio session + player without reintroducing click-latency logic in the mode file).
- Shared Circle shell/orchestration: `src/ui/circle-of-fifths.ts`.
- Circle note-bar DOM + trail lifecycle: `src/ui/circle-note-bar.ts`.
- Dedicated mode adapter: `src/modes/circle-of-fifths.ts`.
- Outer ring has 12 primary wedges in circle-of-fifths order.
- Detail layer has 2 inner rings:
  - middle: three minor wedges (`ii`, `iii`, `vi`)
  - inner: one diminished wedge (`vii°`)
  - preserve a visible annular gap between middle and inner rings; do not let rings touch/overlap
- **Tap zone split (no chord mode toggle):**
  - Each outer wedge is split angularly: CCW 40% = note-only tap, CW 60% = chord tap.
  - CCW tap plays the single note; does not change the primary (inner circle) selection.
  - CW tap plays the major chord; moves the inner circle to that key (except IV/V which don't move primary).
  - IV/V CW taps play the chord without changing the primary.
  - Tap outside the circle clears the inner circle (no sound).
  - There is no separate chord mode state, no zoom, no double-tap entry.
- Instrument label arcs along the inner-circle boundary, always antipodal to the detail wedge group; rotates smoothly when the primary changes.
- When a primary note is selected, note-bar rows show bold uppercase roman numerals in a left column beside each diatonic note square.
- Note-bar rectangles must stay visibly filled for all degrees; `ii/iii/vi/vii` can be more muted than `I/IV/V` but should remain clearly visible.
- Note-bar cells expand leftward (`transform-origin: right center`) on press/active so they don't clip at the CoF edge.
- Double-tapping SVG background inside the circle cycles instruments and updates the inner indicator text.
- Holding a circle wedge sustains playback while pressed, then releases on pointer end/cancel/leave.
  - CW zone hold: sustains major chord.
  - CCW zone hold: sustains single note.
- Note-bar notes follow the same press lifecycle as wedges: sound starts on pointer down and ends on pointer up/cancel/leave.
- Playback latency contract: Circle note/chord onset is instrument behavior, not cosmetic UI feedback. Trigger sound on pointer-down immediately on both desktop and mobile paths; do not add intentional single-tap delays for click/double-click arbitration.
- Sustained playback uses looped sample regions derived from zero-crossing loop points per instrument sample.
- Note-bar trail behavior:
  - each played note spawns a separate trail object under the note square
  - while held/sounding, trail stretch keeps its right edge pinned under the note square and extends left at a constant velocity
  - on release/end, that same trail keeps its width and both edges move left at the same velocity (about 2 seconds across the circle)
  - repeated note/chord pulses stack trails instead of replacing them, so rhythmic gaps remain visible between trails
  - roman numeral degree labels never animate with the trail
- Rapid double-taps on the same target are debounced to prevent a second short re-attack.
- Circle instrument set:
  - `ACOUSTIC GUITAR`
  - `ELECTRIC GUITAR`
  - `SPANISH GUITAR`
  - `PIPE ORGAN`
  - `HOUSE ORGAN`
- Inner detail rotation should always follow shortest angular path when primary changes.
- Chord MIDI generation must keep the chord root as the first/lowest note and normalize octave consistently.

## Instrument philosophy (Wild Tuna + Circle of Fifths)
- Shared low-latency instrument router: `src/app/audio-session.ts` (register instruments, fan out note lifecycle, keep pointerdown audio dispatch ahead of subscriber work).
- Shared note-event infrastructure should preserve stacked pulses as separate note lifecycles; do not collapse repeated attacks of the same pitch/chord into one active slot.
- Every interactive note surface (circle flowers, key-zoom chord flowers, note bar buttons, fretboard dots) is a **musical instrument**, not a UI button.
- Notes **ring out while the finger/pointer is held down** and stop when it is released.
- Sustained playback uses looped sample regions so the note plays indefinitely during the hold.
- The looper records the **actual held duration** via `recordHoldStart` / `recordHoldEnd` — never a fixed fallback duration.
- Visual trails grow while the note is held and reflect the actual duration; a longer hold produces a longer trail.
- Do **not** regress to one-shot `playMidi`/`playChord` calls or `recordPulse` with a fixed duration for live user presses. Those are for looper-playback events only.
- Trigger audio on `pointerdown`, not `click` or `mouseup` — mobile click fires after `pointerup` and would introduce audible latency.

## Wild Tuna mode notes
- Shared normalized note-event hub: `src/app/note-events.ts`.
- Entry point: `src/modes/wild-tuna.ts`.
- Three-pane layout: Drum Machine (top) | timeline row | Circle of Fifths + Fretboard (bottom).
- Two `CompositeLooper` instances (`src/ui/ui-composite-looper.ts`) record MIDI from the Circle and Fretboard.
- All timing is driven by the drum machine transport via `onTransportStart`, `onTransportStop`, `onBeatBoundary` callbacks.
- REC logic is coordinated centrally: only one looper records at a time; if transport is stopped, pressing REC triggers a 4-beat woodblock count-in before recording starts.
- **Timeline:** `.wt-timeline-block` buttons show 4 global measures. Each block contains 16 `.wt-timeline-step` spans that light up based on note density at that step across all loopers (opacity scales with note count). Tapping a block seeks all loopers to that measure.
- **Looper controls:** REC button (with indicator dot: dim=idle, pink=armed, red+blink=recording) and CLR button. No PLAY button. CLR wipes the loop and is disabled during recording.
- Share URL (`?mode=wild-tuna&track=<base64url(JSON)>`) encodes drum pattern + loop MIDI for both instruments.
- `globalMeasureIndex` tracks the active timeline measure independently of each looper's internal position.
- Shared transport/session event bus for cross-UI timing coordination: `src/app/session-transport.ts` (used by Wild Tuna to fan out drum transport start/stop/beat events deterministically).
- Share payload encode/decode + version/schema validation lives in `src/app/share-payloads.ts`; avoid ad-hoc base64/JSON parsers in mode/UI files.
- **Track API:** `getWildTunaTrackApi()` returns a `WildTunaTrackApi` that aggregates `NoteOn`/`NoteOff` events from both loopers. Consumers subscribe via `onNoteOn`/`onNoteOff` or poll `getActiveNotes()`.

## Extra Jimmy mode notes
- Entry point: `src/modes/extra-jimmy.ts`.
- Harmony calculation logic: `getDiatonicHarmonyMidi()` in `src/fretboard-logic.ts`.
- Markup: `public/index.html` (mode screen article).
- Styles: `public/styles/70-extra-jimmy.css`.
- **Layout**: Three columns arranged horizontally — low fretboard (left, flex 1) | narrow controls (80px, fixed) | high fretboard (right, flex 1).
- **Fretboards**: Two independent `createFretboardUi` instances, each cloned from the `#fretboard-template`. Both display in "key" mode (not scale/chord).
- **Shared state**: Both fretboards always show the same key, scale, and harmony interval. Key changes and scale selection affect both boards simultaneously via `syncBoards()`.
- **Harmony**: When tapping a note on one fretboard, plays both the tapped note and its diatonic harmony partner on the other fretboard. Harmony interval is 1–10 scale degrees (2nd through 11th). Calculation wraps scale degrees and respects octave boundaries.
- **Tap behavior**: Tapping a note on the low fretboard plays the note + its harmony partner on the high fretboard (below the harmony interval). Tapping the high fretboard reverses the harmony direction (plays the note + its harmony partner below on the low fretboard).
- **Audio**: Both notes play simultaneously from a single fretboard guitar sample, pitch-shifted to match MIDI values. Uses `fetchFretboardSample()` and Web Audio API.
- **Controls**:
  - Harmony select: 9 options (2nd–11th degrees).
  - Key button: Opens a 3×4 grid popup to select the tonal root (C–B). Button text updates to show selected key.
  - Scale select: 7 diatonic modes (Major, Minor, Dorian, Mixolydian, Phrygian, Lydian, Locrian).
  - One shared `TARGET` button arms zoom on both boards; the next note tapped on either board consumes the arm and zooms only that board.
  - All controls are in the center column; per-fretboard controls (root note, display mode, annotations) are completely hidden.
- **Resize handling**: Each fretboard viewport observes its parent container; the layout automatically sizes fretboards to fill available space.
- **Cleanup**: On mode exit, disconnect resize observers, tear down UI instances, and close audio context.

## Mobile audio routing
- Audio output on mobile **must use the media channel**, not the ringer/notification channel.
- This is enforced by setting `navigator.audioSession.type = "playback"` (in a try/catch) before creating the `AudioContext` — see `src/app/audio-context-service.ts`.
- Apply this unconditionally for all browsers, not just iOS; Android Chrome also supports the `audioSession` API.
- Do **not** move this call inside an iOS-only branch — this bug has recurred and the fix must remain platform-agnostic.

## Testing expectations
- Keep assertions deterministic (text, selected state, counts, visibility).
- Cover interaction flow in Playwright with at least desktop and mobile projects.
- Avoid test-only branches in runtime code.
- Prefer unit tests for pure state/serialization modules (`src/app/share-payloads.ts`, `src/app/session-transport.ts`, `src/ui/ui-composite-looper.ts`) and reserve Playwright for integrated UI flows.

## CSS maintainability
- CSS lint rules are defined in `.stylelintrc.cjs`.
- Keep drift low by running `npm run lint:css:fix` on style edits.
- Property order is enforced (`stylelint-order`) to keep diffs deterministic.
- Styles are split into ordered files under `public/styles/` and imported via `public/style.css`; see `docs/CSS_MAINTENANCE.md`.
- Circle note-bar/trail styles are isolated in `public/styles/61-circle-note-bar.css` to reduce regressions while iterating wedge/zoom visuals.
