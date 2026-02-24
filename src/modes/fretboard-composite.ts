import { createFretboardUi } from "../ui/fretboard.js";
import { createDrumMachineUi } from "../ui/drum-machine.js";
import {
  getChordTapPlaybackTargets,
  getIntervals,
  getKeyTapPlaybackTargets,
  type CharacteristicType,
  type FretboardPlaybackTarget,
  type FretboardState,
  type NoteName,
} from "./fretboard-logic.js";
import type { LooperRecordable, LooperRecorder } from "./looper-recordable.js";
import { createUiCompositeLooper } from "./ui-composite-looper.js";
import type { ModeDefinition } from "./types.js";

const DEFAULT_STATE: FretboardState = {
  root: "C",
  display: "scale",
  characteristic: "major",
  annotation: "notes",
};
const GUITAR_SAMPLE_URL = "assets/audio/fretboard/guitar-acoustic-c4.mp3";
const GUITAR_SAMPLE_BASE_MIDI = 60;
const FRETBOARD_NOTE_GAIN = 0.84;
const PLAY_CHORD_DURATION_MS = 1000;
const PLAY_SCALE_STEP_MS = 180;
const PLAY_SCALE_NOTE_DURATION_MS = 160;

const NOTE_TO_SEMITONE: Record<NoteName, number> = {
  A: 9,
  "A#": 10,
  B: 11,
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
};

function createDebugFretboardMarkup(): string {
  return `
    <div class="fretboard-layout">
      <div class="fretboard-board" aria-label="Guitar fretboard">
        <div class="fretboard-string-labels" aria-hidden="true">
          <span>E</span>
          <span>A</span>
          <span>D</span>
          <span>G</span>
          <span>B</span>
          <span>E</span>
        </div>
        <div class="fretboard-open-indicators" aria-hidden="true"></div>
        <div class="fretboard-frets" aria-hidden="true"></div>
        <div class="fretboard-strings" aria-hidden="true"></div>
        <div class="fretboard-inlays" aria-hidden="true">
          <span class="fretboard-inlay" style="--fret-index: 3" data-fret="3"></span>
          <span class="fretboard-inlay" style="--fret-index: 5" data-fret="5"></span>
          <span class="fretboard-inlay" style="--fret-index: 7" data-fret="7"></span>
          <span class="fretboard-inlay" style="--fret-index: 9" data-fret="9"></span>
          <span class="fretboard-inlay fretboard-inlay--double-left" style="--fret-index: 12" data-fret="12"></span>
          <span class="fretboard-inlay fretboard-inlay--double-right" style="--fret-index: 12" data-fret="12"></span>
        </div>
        <div class="fretboard-dots" aria-live="polite"></div>
      </div>

      <div class="fretboard-controls">
        <div class="fretboard-note-selector" role="radiogroup" aria-label="Root note" data-fretboard-hideable>
          <button type="button" data-fretboard-root="A">A</button>
          <button type="button" data-fretboard-root="A#">A#</button>
          <button type="button" data-fretboard-root="B">B</button>
          <button type="button" data-fretboard-root="C">C</button>
          <button type="button" data-fretboard-root="C#">C#</button>
          <button type="button" data-fretboard-root="D">D</button>
          <button type="button" data-fretboard-root="D#">D#</button>
          <button type="button" data-fretboard-root="E">E</button>
          <button type="button" data-fretboard-root="F">F</button>
          <button type="button" data-fretboard-root="F#">F#</button>
          <button type="button" data-fretboard-root="G">G</button>
          <button type="button" data-fretboard-root="G#">G#</button>
        </div>

        <div class="fretboard-segmented" data-fretboard-hideable>
          <button type="button" data-fretboard-display="chord">Chord</button>
          <button type="button" data-fretboard-display="scale">Scale</button>
          <button type="button" data-fretboard-display="key">Key</button>
        </div>

        <label class="fretboard-characteristic-label" for="fretboard-characteristic" data-fretboard-hideable>Characteristic</label>
        <select id="fretboard-characteristic" class="fretboard-characteristic" data-fretboard-hideable></select>

        <div class="fretboard-segmented" data-fretboard-hideable>
          <button type="button" data-fretboard-annotation="notes">Notes</button>
          <button type="button" data-fretboard-annotation="degrees">Degrees</button>
        </div>

        <div class="fretboard-actions" data-fretboard-hideable>
          <button type="button" class="fretboard-play-action" data-fretboard-play>Play</button>
          <button type="button" class="fretboard-hide-action" data-fretboard-hide>Hide</button>
        </div>
        <button type="button" class="fretboard-hidden-summary" data-fretboard-summary hidden aria-label="Show fretboard selectors"></button>
      </div>
    </div>
  `;
}

function createDebugDrumMarkup(): string {
  return `
    <div class="drum-mock debug-composite-drum" data-signature="4/4">
      <div class="drum-rotator">
        <div class="drum-ui">
          <div class="drum-tempo">
            <button class="ghost-btn" type="button" data-tempo="down">-</button>
            <div>
              <div id="drum-tempo-value" class="tempo-value">120</div>
              <div class="tempo-label">BPM</div>
            </div>
            <button class="ghost-btn" type="button" data-tempo="up">+</button>
          </div>
          <div class="drum-beat-picker">
            <button id="drum-beat-button" class="ghost-btn drum-random" type="button" aria-haspopup="menu" aria-expanded="false">Beat</button>
            <div id="drum-beat-menu" class="option-menu" role="menu">
              <button type="button" role="menuitem" data-beat="rock">Rock</button>
              <button type="button" role="menuitem" data-beat="shuffle">Shuffle</button>
              <button type="button" role="menuitem" data-beat="disco">Disco</button>
              <button type="button" role="menuitem" data-beat="half-time">Half-Time</button>
              <button type="button" role="menuitem" data-beat="breakbeat">Breakbeat</button>
              <button type="button" role="menuitem" data-beat="afrobeat">Afrobeat</button>
              <button type="button" role="menuitem" data-beat="minimal">Minimal</button>
            </div>
          </div>
          <div class="drum-beat-picker">
            <button id="drum-kit-button" class="ghost-btn drum-random drum-kit-trigger" type="button" aria-haspopup="menu" aria-expanded="false">
              Kit: <span id="drum-kit-label">Rock</span>
            </button>
            <div id="drum-kit-menu" class="option-menu" role="menu">
              <button type="button" role="menuitem" data-kit="rock">Rock Drums</button>
              <button type="button" role="menuitem" data-kit="electro">Electro Drum Machine</button>
              <button type="button" role="menuitem" data-kit="house">House Drums</button>
              <button type="button" role="menuitem" data-kit="lofi">Lo-Fi Pocket</button>
              <button type="button" role="menuitem" data-kit="latin">Latin Percussion</button>
              <button type="button" role="menuitem" data-kit="woodblock">Woodblock Ensemble</button>
            </div>
          </div>
          <button id="drum-play-toggle" class="primary-btn drum-play" type="button">Play</button>
        </div>
        <div class="drum-grids">
          <div class="drum-playhead" aria-hidden="true"></div>
          <div class="drum-grid" data-signature="4/4">
            <div class="drum-row" data-voice="kick"><div class="drum-label">Kick</div><div class="drum-steps">
              <button class="step is-on" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button>
              <button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button>
              <button class="step is-on" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button>
              <button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button>
            </div></div>
            <div class="drum-row" data-voice="snare"><div class="drum-label">Snare</div><div class="drum-steps">
              <button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button>
              <button class="step is-on" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button>
              <button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button>
              <button class="step is-on" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button>
            </div></div>
            <div class="drum-row" data-voice="hat"><div class="drum-label">Hat</div><div class="drum-steps">
              <button class="step is-on" type="button"></button><button class="step" type="button"></button><button class="step is-on" type="button"></button><button class="step" type="button"></button>
              <button class="step is-on" type="button"></button><button class="step" type="button"></button><button class="step is-on" type="button"></button><button class="step" type="button"></button>
              <button class="step is-on" type="button"></button><button class="step" type="button"></button><button class="step is-on" type="button"></button><button class="step" type="button"></button>
              <button class="step is-on" type="button"></button><button class="step" type="button"></button><button class="step is-on" type="button"></button><button class="step" type="button"></button>
            </div></div>
            <div class="drum-row" data-voice="perc"><div class="drum-label">Perc</div><div class="drum-steps">
              <button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button>
              <button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button>
              <button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button>
              <button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button><button class="step" type="button"></button>
            </div></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function createFretboardCompositeMode(): ModeDefinition {
  const modeEl = document.querySelector<HTMLElement>('.mode-screen[data-mode="fretboard-composite"]');
  let drumUi: ReturnType<typeof createDrumMachineUi> | null = null;
  let looperUi: ReturnType<typeof createUiCompositeLooper> | null = null;
  let fretboardUi: ReturnType<typeof createFretboardUi> | null = null;
  let rootEl: HTMLElement | null = null;
  let state: FretboardState = { ...DEFAULT_STATE };
  let looperRecorder: LooperRecorder | null = null;
  const fretboardRecordable: LooperRecordable = {
    setLooperRecorder: (recorder) => {
      looperRecorder = recorder;
    },
  };

  let audioContext: AudioContext | null = null;
  let sampleBuffer: AudioBuffer | null = null;
  let sampleLoadPromise: Promise<AudioBuffer | null> | null = null;
  let playEndTimer: number | null = null;
  const activeSources = new Set<AudioScheduledSourceNode>();
  const pulseTimers = new Set<number>();

  const getAudioContextCtor = () =>
    window.AudioContext ??
    ((window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null);

  const ensureAudioContext = async (): Promise<AudioContext | null> => {
    if (audioContext && audioContext.state !== "closed") {
      await audioContext.resume();
      return audioContext;
    }
    const AudioCtx = getAudioContextCtor();
    if (!AudioCtx) return null;
    audioContext = new AudioCtx({ latencyHint: "interactive" });
    await audioContext.resume();
    return audioContext;
  };

  const ensureSample = async (ctx: AudioContext): Promise<AudioBuffer | null> => {
    if (sampleBuffer) return sampleBuffer;
    if (sampleLoadPromise) return sampleLoadPromise;
    sampleLoadPromise = (async () => {
      try {
        const response = await fetch(GUITAR_SAMPLE_URL);
        if (!response.ok) return null;
        const data = await response.arrayBuffer();
        const decoded = await ctx.decodeAudioData(data);
        sampleBuffer = decoded;
        return decoded;
      } catch {
        return null;
      } finally {
        sampleLoadPromise = null;
      }
    })();
    return sampleLoadPromise;
  };

  const registerSource = (source: AudioScheduledSourceNode): void => {
    activeSources.add(source);
    source.addEventListener("ended", () => activeSources.delete(source), { once: true });
  };

  const stopActiveSources = (): void => {
    activeSources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Ignore already-ended source errors.
      }
    });
    activeSources.clear();
  };

  const clearPulseTimers = (): void => {
    pulseTimers.forEach((id) => window.clearTimeout(id));
    pulseTimers.clear();
  };

  const schedulePulse = (
    targets: FretboardPlaybackTarget[],
    delayMs: number,
    durationMs: number
  ): void => {
    const timeoutId = window.setTimeout(() => {
      pulseTimers.delete(timeoutId);
      fretboardUi?.pulseTargets(targets, durationMs);
    }, Math.max(0, delayMs));
    pulseTimers.add(timeoutId);
  };

  const playFallbackToneAt = (
    ctx: AudioContext,
    midi: number,
    startTimeSec: number,
    durationMs: number
  ): void => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const freqHz = 440 * Math.pow(2, (midi - 69) / 12);
    const durationSec = Math.max(0.02, durationMs / 1000);
    osc.type = "triangle";
    osc.frequency.value = freqHz;
    gain.gain.setValueAtTime(0.0001, startTimeSec);
    gain.gain.exponentialRampToValueAtTime(0.22, startTimeSec + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTimeSec + durationSec);
    osc.connect(gain);
    gain.connect(ctx.destination);
    registerSource(osc);
    osc.start(startTimeSec);
    osc.stop(startTimeSec + durationSec + 0.01);
  };

  const playSampleAt = (
    ctx: AudioContext,
    sample: AudioBuffer,
    midi: number,
    startTimeSec: number,
    durationMs: number
  ): void => {
    const source = ctx.createBufferSource();
    source.buffer = sample;
    source.playbackRate.value = Math.pow(2, (midi - GUITAR_SAMPLE_BASE_MIDI) / 12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(FRETBOARD_NOTE_GAIN, startTimeSec);
    source.connect(gain);
    gain.connect(ctx.destination);
    registerSource(source);
    source.start(startTimeSec);
    if (durationMs > 0) source.stop(startTimeSec + durationMs / 1000);
  };

  const playMidiAt = (
    ctx: AudioContext,
    sample: AudioBuffer | null,
    midi: number,
    startTimeSec: number,
    durationMs: number
  ): void => {
    if (sample) {
      playSampleAt(ctx, sample, midi, startTimeSec, durationMs);
      return;
    }
    playFallbackToneAt(ctx, midi, startTimeSec, durationMs);
  };

  const playTargets = async (
    targets: FretboardPlaybackTarget[],
    durationMs: number,
    shouldRecord = true
  ): Promise<void> => {
    if (!targets.length) return;
    const midis = targets.map((target) => target.midi);
    if (shouldRecord) looperRecorder?.recordPulse(midis, durationMs);
    const ctx = await ensureAudioContext();
    if (!ctx) return;
    const sample = await ensureSample(ctx);
    const startTimeSec = ctx.currentTime + 0.01;
    targets.forEach((target) => playMidiAt(ctx, sample, target.midi, startTimeSec, durationMs));
    fretboardUi?.pulseTargets(targets, durationMs);
  };

  const clearPlayback = (): void => {
    if (playEndTimer !== null) {
      window.clearTimeout(playEndTimer);
      playEndTimer = null;
    }
    clearPulseTimers();
    stopActiveSources();
  };

  const playPattern = async (): Promise<void> => {
    const intervals = [...new Set(getIntervals(state.display, state.characteristic as CharacteristicType))]
      .map((interval) => ((interval % 12) + 12) % 12)
      .sort((a, b) => a - b);
    if (!intervals.length) return;
    const rootSemitone = NOTE_TO_SEMITONE[state.root] ?? 0;
    const rootMidi = GUITAR_SAMPLE_BASE_MIDI + rootSemitone;
    const ctx = await ensureAudioContext();
    if (!ctx) return;
    const sample = await ensureSample(ctx);
    clearPlayback();
    const startTimeSec = ctx.currentTime + 0.02;

    if (state.display !== "chord") {
      const scaleMidis = intervals.map((interval) => rootMidi + interval);
      scaleMidis.push(rootMidi + 12);
      scaleMidis.forEach((midi, index) => {
        const at = startTimeSec + (index * PLAY_SCALE_STEP_MS) / 1000;
        playMidiAt(ctx, sample, midi, at, PLAY_SCALE_NOTE_DURATION_MS);
        schedulePulse(
          [{ midi, stringIndex: 0, isRoot: ((midi % 12) + 12) % 12 === rootSemitone }],
          index * PLAY_SCALE_STEP_MS,
          PLAY_SCALE_NOTE_DURATION_MS
        );
      });
      playEndTimer = window.setTimeout(() => {
        playEndTimer = null;
        stopActiveSources();
      }, PLAY_SCALE_NOTE_DURATION_MS + PLAY_SCALE_STEP_MS * Math.max(0, scaleMidis.length - 1) + 60);
      return;
    }

    const chordTargets = intervals.map((interval, index): FretboardPlaybackTarget => ({
      midi: rootMidi + interval,
      stringIndex: index,
      isRoot: interval === 0,
    }));
    chordTargets.forEach((target) =>
      playMidiAt(ctx, sample, target.midi, startTimeSec, PLAY_CHORD_DURATION_MS)
    );
    schedulePulse(chordTargets, 0, PLAY_CHORD_DURATION_MS);
    playEndTimer = window.setTimeout(() => {
      playEndTimer = null;
      stopActiveSources();
    }, PLAY_CHORD_DURATION_MS + 60);
  };

  return {
    id: "fretboard-composite",
    title: "Fretboard Composite",
    icon: "FC",
    preserveState: false,
    canFullscreen: false,
    onEnter: async () => {
      if (!modeEl) return;
      looperUi?.destroy();
      looperUi = null;
      rootEl?.remove();
      state = { ...DEFAULT_STATE };

      const shell = document.createElement("div");
      shell.className = "fretboard-composite-shell";
      shell.innerHTML = `
        <section class="fretboard-composite-pane fretboard-composite-pane--drum">
          ${createDebugDrumMarkup()}
        </section>
        <section class="fretboard-composite-pane fretboard-composite-pane--fretboard">
          <div class="fretboard-composite-looper-host" data-fretboard-composite-looper></div>
          ${createDebugFretboardMarkup()}
        </section>
      `;
      rootEl = shell;
      modeEl.replaceChildren(shell);

      const drumRoot = shell.querySelector<HTMLElement>(".fretboard-composite-pane--drum");
      const fretboardHost = shell.querySelector<HTMLElement>(".fretboard-composite-pane--fretboard");
      const looperHost = shell.querySelector<HTMLElement>("[data-fretboard-composite-looper]");
      if (!drumRoot || !fretboardHost || !looperHost) return;

      looperUi = createUiCompositeLooper({
        getMeasureDurationMs: () => {
          const bpm = drumUi?.getBpm() ?? 120;
          return (60 / Math.max(1, bpm)) * 4 * 1000;
        },
        onPlaybackEvent: (event) => {
          const targets = event.midis.map((midi, index) => ({
            midi,
            stringIndex: index,
            isRoot: index === 0,
          }));
          void playTargets(targets, event.durationMs, false);
        },
      });
      looperHost.replaceChildren(looperUi.rootEl);
      fretboardRecordable.setLooperRecorder(looperUi);

      drumUi = createDrumMachineUi(drumRoot, {
        onTransportStart: () => looperUi?.onTransportStart(),
        onTransportStop: () => looperUi?.onTransportStop(),
        onBeatBoundary: (event) => looperUi?.onBeatBoundary(event),
      });

      fretboardUi = createFretboardUi(fretboardHost, {
        initialState: DEFAULT_STATE,
        showControls: true,
        onStateChange: (nextState) => {
          state = nextState;
        },
        onPlayPress: () => {
          void playPattern();
        },
        onFretPress: ({ midi, stringIndex, fret }) => {
          if (state.display === "chord") {
            const chordTargets = getChordTapPlaybackTargets({
              chordRoot: state.root,
              characteristic: state.characteristic,
              tappedMidi: midi,
              tappedStringIndex: stringIndex,
            });
            void playTargets(chordTargets, 520, true);
            return;
          }
          if (state.display === "key") {
            const keyTargets = getKeyTapPlaybackTargets({
              keyRoot: state.root,
              keyMode: state.characteristic,
              tappedMidi: midi,
              tappedStringIndex: stringIndex,
            });
            void playTargets(keyTargets, 560, true);
            return;
          }
          void playTargets([{ midi, stringIndex, isRoot: fret === 0 }], 360, true);
        },
      });
      fretboardUi.enter();
      await drumUi.enter();
    },
    onExit: () => {
      fretboardUi?.exit();
      fretboardUi = null;
      clearPlayback();
      if (audioContext && audioContext.state !== "closed") void audioContext.close();
      audioContext = null;
      sampleBuffer = null;
      sampleLoadPromise = null;
      looperUi?.destroy();
      looperUi = null;
      fretboardRecordable.setLooperRecorder(null);
      drumUi?.exit();
      drumUi?.destroy();
      drumUi = null;
      rootEl?.remove();
      rootEl = null;
    },
  };
}
