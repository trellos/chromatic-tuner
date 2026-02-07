# Copilot Instructions for Chromatic Tuner

## Architecture Overview

This is a **web-based multi-mode music tool** (Chromatic Tuner, Metronome, Drum Machine) using the Web Audio API with real-time pitch detection. It runs as a simple Express dev server serving a static HTML app that processes microphone input through an AudioWorklet.

It is designed to look like a Peterson Strobe Tuner, providing accurate note and cents offset readings with minimal latency and jitter.

### Key Components

- **[src/main.ts](../src/main.ts)**: Browser UI layer - mode carousel, fullscreen toggle, screen visibility, lifecycle hooks for modes
- **[src/modes/tuner.ts](../src/modes/tuner.ts)**: Tuner implementation and lifecycle (AudioContext, mic, strobe UI)
- **[src/modes/metronome.ts](../src/modes/metronome.ts)**: Metronome UI + audio scheduler (tempo dial, time menu, beat pulse)
- **[src/modes/drum-machine.ts](../src/modes/drum-machine.ts)**: Drum machine UI + sequencer (grid playback, playhead, beat menu)
- **[src/audio/worklet.ts](../src/audio/worklet.ts)**: AudioWorklet processor - runs in audio thread, implements YIN pitch detection algorithm
- **[public/index.html](../public/index.html)**: Multi-mode HTML layout (carousel, screens, controls)
- **[scripts/build.mjs](../scripts/build.mjs)** & **[scripts/dev.mjs](../scripts/dev.mjs)**: esbuild configuration for bundling main app and worklet separately

### Data Flow

1. Requests microphone permission via getUserMedia()
2. Audio input â†’ MediaStreamSource â†’ AudioWorkletNode (tuner)
3. Worklet samples continuously, analyzes every ~50ms (20 Hz hop rate)
4. Worklet sends pitch messages: `{type: "pitch", freqHz, confidence, rms}`
5. Main thread receives, applies median filtering, EMA smoothing, and note-locking logic
6. UI updates with note name (MIDI) and cents offset (Â±50 cents from locked note)

## Critical Development Patterns

### AudioWorklet as Separate Bundle
The worklet **must be a separate JS file** that the browser fetches via `audioContext.audioWorklet.addModule("./assets/worklet.js")`. The build system handles this automatically - **do not bundle worklet.ts into main.ts**.

### YIN Pitch Detection Implementation
The worklet uses the **YIN algorithm** with these steps:
1. Compute difference function (autocorrelation-like)
2. Cumulative mean normalized difference (CMND)
3. Find first dip below threshold (0.15), then walk to local minimum
4. Parabolic interpolation for sub-sample precision
5. Gate output on RMS > 0.01 and confidence > 0.75

**Tuning range is hard-coded to 60â€“1200 Hz** in `yinDetect()` - tune detection frequency sensitivity here.

### Note Locking & Smoothing
Main thread uses a **3-layer filtering strategy**:
1. **Median filter** on rolling history (N=5): kills frequency spikes
2. **Hysteresis lock**: new note requires 3 consecutive frames (~150ms) to switch
3. **EMA filter on cents** (Î±=0.2): smooth offset display without lag

This prevents flickering between adjacent notes.

### TypeScript Strictness
- `noUncheckedIndexedAccess: true` enforces optional chaining on array accesses
- Use `arr[i] ?? fallback` pattern throughout, especially in tight loops
- Worklet extensively uses `const v = x[i] ?? 0` to avoid undefined surprises

## Build & Development Workflow

### Commands
- **`npm run build`**: Clean build to `dist/`. Bundles `main.ts` â†’ `dist/assets/app.js` and `worklet.ts` â†’ `dist/assets/worklet.js`, copies public assets
- **`npm run dev`**: Starts Express server on `http://localhost:3000` with esbuild watch mode for both entry points

### Watch Mode Details
Dev script uses **separate esbuild contexts** for app and worklet, allowing independent rebuilds. Public assets are watched and recopied on change via chokidar.

## Project-Specific Conventions

1. **Note representation**: MIDI numbers (C0=12 through C8=108). `NOTE_NAMES` array uses chromatic order `["C", "C#", "D", ... "B"]`
2. **Frequency-to-MIDI**: `12 * logâ‚‚(freqHz / A4) + 69` where A4 = 440 Hz
3. **Cents are always relative to the locked MIDI note** (Â±50 range), not absolute pitch
4. **RMS gating**: silence detection at < 0.01, confidence must exceed 0.75 for output
5. **Ring buffer in worklet** (16384 samples): circular buffer for streaming input, maintains write index with wrapping
6. **Command**: Design layouts to look good across all mobile browsers, regardless of resolution or aspect ratio (use adaptive/responsive CSS rather than device-specific tweaks).

## External Integration Points

- **Web Audio API**: AudioContext, MediaStreamSource, AudioWorkletNode (browser standard)
- **getUserMedia**: Requests microphone with AGC/echo-cancellation/noise-suppression disabled (critical for tuning accuracy)
- **Express**: Serves static files only - no API logic

## Mode Lifecycle & Fullscreen

- Modes are registered in `src/modes/*` and expose `onEnter`/`onExit` hooks.
- `main.ts` calls lifecycle hooks when switching modes.
- Fullscreen behavior is **only** supported for Drum Machine; other modes disable the toggle.
- Fullscreen hides the carousel/header and shows the in-mode exit button.

## Metronome Behavior

- Tempo is adjusted via the rotary dial (pointer drag, wheel, keyboard arrows).
- Time menu supports `4/4`, `3/4`, `6/8`, and `No Accent` for accent control.
- Metronome schedules ahead with a short lookahead timer and pulses the starburst on beat.

## Drum Machine Behavior

- Uses a 4-row step grid (Kick, Snare, Hat, Perc) with 16 steps for 4/4 and 12 for 3/4 or 6/8.
- Playhead is a moving column highlight plus playhead bar.
- Tempo is adjustable via +/- buttons in the rotated toolbar.
- Beat menu applies preset patterns (Rock, Shuffle, Disco, Half-Time, Breakbeat, Afrobeat, Minimal).

## When Adding Features

- **New tuning algorithms**: Modify `yinDetect()` in worklet.ts, test with various instrument frequencies
- **UI enhancements**: Update mode files and HTML/CSS; keep mode lifecycle logic in `main.ts`
- **Audio settings**: Adjust `hopFrames`, `windowSize`, confidence threshold, or frequency range in worklet constructor
- **Note display**: Change `NOTE_NAMES` array or octave offset in `midiToNoteName()`

## iOS Workarounds (Important)

These changes exist specifically to address iOS Safari audio capture quirks.

- **AudioContext warm-up**: `createAudioContext()` performs a short silent-buffer warm-up on iOS before creating the real context. This avoids a "bad" initial context state some iOS versions can enter.
- **iOS ScriptProcessor fallback**: On iOS, a `ScriptProcessorNode` runs in parallel with the AudioWorklet and supplies the *actual* pitch used for display. This bypasses iOS AudioWorklet capture anomalies.
- **Wall-clock sample-rate correction**: The ScriptProcessor path measures an effective sample rate using `performance.now()` and uses that for pitch detection (`wallSR`). This compensates for timebase skew in mic capture.
- **Low-pass assist for acoustic guitars**: iOS ScriptProcessor path runs YIN on both the raw signal and a low-pass filtered signal (~500 Hz) and prefers the low-pass estimate when it is more reliable. This reduces harmonic locking (e.g., E string reading as A).
- **Internal 440 Hz test tone**: Long-press the strobe on iOS toggles a built-in 440 Hz oscillator (`mode=osc`) that bypasses the mic path. This is used to validate analyzer correctness when mic input is suspect.
- **Debug mode flag**: Add `?debug` to the URL to reveal the status/debug panel. The flag is controlled by `SHOW_STATUS` in `src/main.ts`.

## Session Notes (Handoff)

- UI: `#reading` (note + cents) moved inside `#strobe-visualizer` and positioned so the text sits within the semicircle.
- Status text: now toggles visibility on tuner tap (hidden by default via `body.status-hidden`).
- Status placement: positioned just below the semicircle midline, not below the full circle.
- iOS: mic requires HTTPS. Added guard for missing `getUserMedia`. Audio input now blends stereo channels (uses mono if only channel 0 exists).
- SVG: strobe arcs are now SVG paths (top semicircle) instead of clipped circles (better iOS rendering).
- CSS: strobe SVG sized to 100% to avoid offset on mobile.

