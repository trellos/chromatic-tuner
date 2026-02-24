import { createCircleGuitarPlayer } from "../audio/circle-guitar-player.js";
import {
  createCircleOfFifthsUi,
  getCircleChordMidis,
  getCircleMajorChordMidis,
  type CircleChordSpec,
  type CircleChordModeOptions,
} from "../ui/circle-of-fifths.js";
import { createDrumMachineUi } from "../ui/drum-machine.js";
import type { LooperRecordable, LooperRecorder } from "./looper-recordable.js";
import { createUiCompositeLooper } from "./ui-composite-looper.js";
import type { ModeDefinition } from "./types.js";

const TAP_PLAYBACK_DEBOUNCE_MS = 440;

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

export function createUiCompositeDebugMode(): ModeDefinition {
  const modeEl = document.querySelector<HTMLElement>('.mode-screen[data-mode="ui-composite-debug"]');
  let drumUi: ReturnType<typeof createDrumMachineUi> | null = null;
  let circleUi: ReturnType<typeof createCircleOfFifthsUi> | null = null;
  let looperUi: ReturnType<typeof createUiCompositeLooper> | null = null;
  let circleRecorder: LooperRecorder | null = null;
  const circleRecordable: LooperRecordable = {
    setLooperRecorder: (recorder) => {
      circleRecorder = recorder;
    },
  };
  let rootEl: HTMLElement | null = null;
  let chordModeActive = false;
  let lastPrimaryLabel: string | null = null;
  let suppressNextTapPlayback = false;
  let lastTapPlaybackAt = 0;
  let lastTapPlaybackSignature = "";
  const guitarPlayer = createCircleGuitarPlayer();

  const shouldSuppressTapPlayback = (): boolean => {
    if (!suppressNextTapPlayback) return false;
    suppressNextTapPlayback = false;
    return true;
  };

  const shouldDebounceTapPlayback = (signature: string): boolean => {
    const now = performance.now();
    if (signature === lastTapPlaybackSignature && now - lastTapPlaybackAt < TAP_PLAYBACK_DEBOUNCE_MS) {
      return true;
    }
    lastTapPlaybackAt = now;
    lastTapPlaybackSignature = signature;
    return false;
  };

  const setChordMode = (next: boolean, modeOptions: CircleChordModeOptions = {}): void => {
    chordModeActive = next;
    circleUi?.setChordMode(next, modeOptions);
  };

  const playMidis = async (
    midis: number[],
    durationMs: number,
    shouldRecord: boolean
  ): Promise<void> => {
    const cleanedMidis = midis
      .filter((value) => Number.isFinite(value))
      .map((value) => Math.round(value));
    if (!cleanedMidis.length) return;
    if (shouldRecord) circleRecorder?.recordPulse(cleanedMidis, durationMs);
    if (cleanedMidis.length === 1) {
      const midi = cleanedMidis[0];
      if (midi === undefined) return;
      circleUi?.pulseNote(midi, durationMs);
      await guitarPlayer.playMidi(midi, durationMs);
      return;
    }
    circleUi?.pulseChord(cleanedMidis, durationMs);
    await guitarPlayer.playChord(cleanedMidis, durationMs);
  };

  const playChord = async (
    chord: CircleChordSpec,
    shouldRecord = true
  ): Promise<void> => {
    const chordMidis = getCircleChordMidis(chord);
    await playMidis(chordMidis, 640, shouldRecord);
  };

  const playPrimary = async (midi: number, shouldRecord = true): Promise<void> => {
    await playMidis([midi], 400, shouldRecord);
  };

  const playMajorChord = async (
    midi: number,
    shouldRecord = true
  ): Promise<void> => {
    const chordMidis = getCircleMajorChordMidis(midi);
    await playMidis(chordMidis, 640, shouldRecord);
  };

  const log = (name: string, payload?: unknown): void => {
    if (payload === undefined) {
      console.info(`[ui-composite-debug] ${name}`);
      return;
    }
    console.info(`[ui-composite-debug] ${name}`, payload);
  };

  return {
    id: "ui-composite-debug",
    title: "UI Debug",
    icon: "UD",
    preserveState: false,
    canFullscreen: false,
    onEnter: async () => {
      if (!modeEl) return;
      document.body.classList.remove("ui-composite-debug-fullscreen");
      looperUi?.destroy();
      looperUi = null;
      rootEl?.remove();
      chordModeActive = false;
      lastPrimaryLabel = null;
      suppressNextTapPlayback = false;
      lastTapPlaybackAt = 0;
      lastTapPlaybackSignature = "";
      const initialInstrumentName = guitarPlayer.setInstrument("guitar-acoustic");

      const shell = document.createElement("div");
      shell.className = "ui-composite-debug-shell";
      shell.innerHTML = `
        <button class="ui-composite-debug-fullscreen-btn ghost-btn" type="button" data-ui-composite-fullscreen>
          Fullscreen
        </button>
        <section class="ui-composite-debug-pane ui-composite-debug-pane--drum">
          ${createDebugDrumMarkup()}
        </section>
        <section class="ui-composite-debug-pane ui-composite-debug-pane--circle">
          <div class="ui-composite-debug-looper-host" data-ui-composite-looper></div>
          <div class="circle-mode-layout ui-composite-debug-circle-host"></div>
        </section>
      `;
      rootEl = shell;
      modeEl.replaceChildren(shell);

      const drumRoot = shell.querySelector<HTMLElement>(".ui-composite-debug-pane--drum");
      const circleHost = shell.querySelector<HTMLElement>(".ui-composite-debug-circle-host");
      const looperHost = shell.querySelector<HTMLElement>("[data-ui-composite-looper]");
      const fullscreenBtn = shell.querySelector<HTMLButtonElement>("[data-ui-composite-fullscreen]");
      if (!drumRoot || !circleHost || !looperHost) return;
      fullscreenBtn?.addEventListener("click", () => {
        log("mode.onFullscreen");
        document.body.classList.add("ui-composite-debug-fullscreen");
      });

      looperUi = createUiCompositeLooper({
        getMeasureDurationMs: () => {
          const bpm = drumUi?.getBpm() ?? 120;
          return (60 / Math.max(1, bpm)) * 4 * 1000;
        },
        onPlaybackEvent: (playback) => {
          void playMidis(playback.midis, playback.durationMs, false);
        },
      });
      looperHost.replaceChildren(looperUi.rootEl);
      circleRecordable.setLooperRecorder(looperUi);

      drumUi = createDrumMachineUi(drumRoot, {
        onTransportStart: () => {
          log("drum.onTransportStart");
          looperUi?.onTransportStart();
        },
        onTransportStop: () => {
          log("drum.onTransportStop");
          looperUi?.onTransportStop();
        },
        onBeatBoundary: (event) => {
          log("drum.onBeatBoundary", event);
          looperUi?.onBeatBoundary(event);
        },
      });

      circleUi = createCircleOfFifthsUi(circleHost, {
        onPrimaryTap: (selection) => {
          log("circle.onPrimaryTap", selection);
          const isPrimaryRetap = selection.primaryLabel === lastPrimaryLabel;
          lastPrimaryLabel = selection.primaryLabel;
          const skipPlayback = shouldSuppressTapPlayback();
          if (isPrimaryRetap) {
            setChordMode(true);
            if (!skipPlayback) {
              if (shouldDebounceTapPlayback(`maj:${selection.primaryMidi}`)) return;
              void playMajorChord(selection.primaryMidi, true);
            }
          } else {
            setChordMode(false);
            if (!skipPlayback) {
              if (shouldDebounceTapPlayback(`note:${selection.primaryMidi}`)) return;
              void playPrimary(selection.primaryMidi, true);
            }
          }
        },
        onSecondaryTap: (chord) => {
          log("circle.onSecondaryTap", chord);
          if (shouldSuppressTapPlayback()) return;
          if (shouldDebounceTapPlayback(`sec:${chord.label}`)) return;
          void playChord(chord, true);
        },
        onOuterTap: (note) => {
          log("circle.onOuterTap", note);
          if (!chordModeActive) return;
          if (shouldSuppressTapPlayback()) return;
          if (shouldDebounceTapPlayback(`maj:${note.midi}`)) return;
          void playMajorChord(note.midi, true);
        },
        onOuterDoubleTap: (note) => {
          log("circle.onOuterDoubleTap", note);
          if (!chordModeActive || !note.isPrimary) return;
          setChordMode(true, { zoomToPrimary: true });
        },
        onOuterPressStart: (note) => {
          log("circle.onOuterPressStart", note);
          suppressNextTapPlayback = true;
          if (chordModeActive) {
            const chordMidis = getCircleMajorChordMidis(note.midi);
            circleRecorder?.recordHoldStart(`outer:maj:${note.midi}`, chordMidis);
            circleUi?.holdChord(chordMidis);
            void guitarPlayer.startSustainChord(chordMidis);
            return;
          }
          circleRecorder?.recordHoldStart(`outer:note:${note.midi}`, [note.midi]);
          circleUi?.holdNote(note.midi);
          void guitarPlayer.startSustainMidi(note.midi);
        },
        onOuterPressEnd: (note) => {
          log("circle.onOuterPressEnd", note);
          if (chordModeActive) {
            circleRecorder?.recordHoldEnd(`outer:maj:${note.midi}`);
          } else {
            circleRecorder?.recordHoldEnd(`outer:note:${note.midi}`);
          }
          circleUi?.releaseHeldNotes();
          guitarPlayer.stopSustain();
        },
        onSecondaryPressStart: (chord) => {
          log("circle.onSecondaryPressStart", chord);
          suppressNextTapPlayback = true;
          const chordMidis = getCircleChordMidis(chord);
          circleRecorder?.recordHoldStart(`secondary:${chord.label}`, chordMidis);
          circleUi?.holdChord(chordMidis);
          void guitarPlayer.startSustainChord(chordMidis);
        },
        onSecondaryPressEnd: (chord) => {
          log("circle.onSecondaryPressEnd", chord);
          circleRecorder?.recordHoldEnd(`secondary:${chord.label}`);
          circleUi?.releaseHeldNotes();
          guitarPlayer.stopSustain();
        },
        onInnerDoubleTap: () => {
          log("circle.onInnerDoubleTap");
          const instrumentName = guitarPlayer.cycleInstrument();
          circleUi?.setInstrumentLabel(instrumentName);
          circleUi?.showInnerIndicator(instrumentName);
        },
        onNoteBarTap: (note) => {
          log("circle.onNoteBarTap", note);
          suppressNextTapPlayback = false;
          void playPrimary(note.midi, true);
        },
        onNoteBarPressStart: (note) => {
          log("circle.onNoteBarPressStart", note);
          suppressNextTapPlayback = true;
          circleRecorder?.recordHoldStart(`note-bar:${note.midi}`, [note.midi]);
          circleUi?.holdNote(note.midi);
          void guitarPlayer.startSustainMidi(note.midi);
        },
        onNoteBarPressEnd: (note) => {
          log("circle.onNoteBarPressEnd", note);
          circleRecorder?.recordHoldEnd(`note-bar:${note.midi}`);
          circleUi?.releaseHeldNotes();
          guitarPlayer.stopSustain();
        },
        onBackgroundTap: () => {
          log("circle.onBackgroundTap");
          if (!chordModeActive) return;
          circleUi?.releaseHeldNotes();
          guitarPlayer.stopSustain();
          setChordMode(false);
        },
        onBackgroundPulseRequest: () => log("circle.onBackgroundPulseRequest"),
        onBackgroundRandomnessRequest: (randomness) =>
          log("circle.onBackgroundRandomnessRequest", randomness),
      });
      circleUi.setInstrumentLabel(initialInstrumentName);

      await drumUi.enter();
      log("mode.onEnter");
    },
    onExit: () => {
      log("mode.onExit");
      document.body.classList.remove("ui-composite-debug-fullscreen");
      chordModeActive = false;
      circleUi?.releaseHeldNotes();
      circleUi?.destroy();
      circleUi = null;
      looperUi?.destroy();
      looperUi = null;
      circleRecordable.setLooperRecorder(null);
      guitarPlayer.stopSustain();
      guitarPlayer.stopAll();
      drumUi?.exit();
      drumUi?.destroy();
      drumUi = null;
      rootEl?.remove();
      rootEl = null;
    },
  };
}
