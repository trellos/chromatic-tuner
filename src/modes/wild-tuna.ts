import { createCircleGuitarPlayer } from "../audio/circle-guitar-player.js";
import { createCircleOfFifthsUi, getCircleChordMidis, getCircleMajorChordMidis } from "../ui/circle-of-fifths.js";
import { createDrumMachineUi } from "../ui/drum-machine.js";
import { createFretboardUi } from "../ui/fretboard.js";
import {
  getChordTapPlaybackTargets,
  getKeyTapPlaybackTargets,
  type CharacteristicType,
  type FretboardPlaybackTarget,
  type FretboardState,
} from "./fretboard-logic.js";
import { createUiCompositeLooper } from "./ui-composite-looper.js";
import type { ModeDefinition } from "./types.js";

const FRETBOARD_DEFAULT_STATE: FretboardState = {
  root: "C",
  display: "scale",
  characteristic: "major",
  annotation: "notes",
};
const FRETBOARD_SAMPLE_URL = "assets/audio/fretboard/guitar-acoustic-c4.mp3";
const FRETBOARD_SAMPLE_BASE_MIDI = 60;
const FRETBOARD_GAIN = 0.84;

type WildTunaModeOptions = {
  onRandomnessChange?: (randomness: number | null) => void;
};

function createFretboardMarkup(): string {
  return `
    <div class="fretboard-layout">
      <div class="fretboard-board" aria-label="Guitar fretboard">
        <div class="fretboard-string-labels" aria-hidden="true"><span>E</span><span>A</span><span>D</span><span>G</span><span>B</span><span>E</span></div>
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
          <button type="button" data-fretboard-root="A">A</button><button type="button" data-fretboard-root="A#">A#</button><button type="button" data-fretboard-root="B">B</button><button type="button" data-fretboard-root="C">C</button><button type="button" data-fretboard-root="C#">C#</button><button type="button" data-fretboard-root="D">D</button><button type="button" data-fretboard-root="D#">D#</button><button type="button" data-fretboard-root="E">E</button><button type="button" data-fretboard-root="F">F</button><button type="button" data-fretboard-root="F#">F#</button><button type="button" data-fretboard-root="G">G</button><button type="button" data-fretboard-root="G#">G#</button>
        </div>
        <div class="fretboard-segmented" data-fretboard-hideable><button type="button" data-fretboard-display="chord">Chord</button><button type="button" data-fretboard-display="scale">Scale</button><button type="button" data-fretboard-display="key">Key</button></div>
        <label class="fretboard-characteristic-label" for="fretboard-characteristic" data-fretboard-hideable>Characteristic</label>
        <select id="fretboard-characteristic" class="fretboard-characteristic" data-fretboard-hideable></select>
        <div class="fretboard-segmented" data-fretboard-hideable><button type="button" data-fretboard-annotation="notes">Notes</button><button type="button" data-fretboard-annotation="degrees">Degrees</button></div>
        <div class="fretboard-actions" data-fretboard-hideable><button type="button" class="fretboard-play-action" data-fretboard-play>Play</button><button type="button" class="fretboard-hide-action" data-fretboard-hide>Hide</button></div>
        <button type="button" class="fretboard-hidden-summary" data-fretboard-summary hidden aria-label="Show fretboard selectors"></button>
      </div>
    </div>
  `;
}

export function createWildTunaMode(options: WildTunaModeOptions = {}): ModeDefinition {
  const modeEl = document.querySelector<HTMLElement>('.mode-screen[data-mode="wild-tuna"]');
  if (!modeEl) {
    return { id: "wild-tuna", title: "Wild Tuna", icon: "WT", preserveState: false, canFullscreen: true };
  }

  const drumHost = modeEl.querySelector<HTMLElement>("[data-wild-tuna-drum]");
  const circleHost = modeEl.querySelector<HTMLElement>("[data-wild-tuna-circle]");
  const circleLooperHost = modeEl.querySelector<HTMLElement>("[data-wild-tuna-circle-looper]");
  const fretboardHost = modeEl.querySelector<HTMLElement>("[data-wild-tuna-fretboard]");
  let drumUi: ReturnType<typeof createDrumMachineUi> | null = null;
  let circleUi: ReturnType<typeof createCircleOfFifthsUi> | null = null;
  let circleLooper: ReturnType<typeof createUiCompositeLooper> | null = null;
  let fretboardUi: ReturnType<typeof createFretboardUi> | null = null;
  let fretboardLooper: ReturnType<typeof createUiCompositeLooper> | null = null;
  let fretboardState: FretboardState = { ...FRETBOARD_DEFAULT_STATE };
  const guitarPlayer = createCircleGuitarPlayer();
  let audioContext: AudioContext | null = null;
  let fretSample: AudioBuffer | null = null;
  let fretSampleLoadPromise: Promise<AudioBuffer | null> | null = null;

  const ensureAudioContext = async (): Promise<AudioContext | null> => {
    if (audioContext && audioContext.state !== "closed") {
      await audioContext.resume();
      return audioContext;
    }
    const AudioCtor =
      window.AudioContext ??
      ((window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null);
    if (!AudioCtor) return null;
    audioContext = new AudioCtor({ latencyHint: "interactive" });
    await audioContext.resume();
    return audioContext;
  };

  const ensureFretSample = async (ctx: AudioContext): Promise<AudioBuffer | null> => {
    if (fretSample) return fretSample;
    if (fretSampleLoadPromise) return fretSampleLoadPromise;
    fretSampleLoadPromise = (async () => {
      try {
        const response = await fetch(FRETBOARD_SAMPLE_URL);
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        fretSample = await ctx.decodeAudioData(bytes);
        return fretSample;
      } catch {
        return null;
      } finally {
        fretSampleLoadPromise = null;
      }
    })();
    return fretSampleLoadPromise;
  };

  const playFretTargets = async (targets: FretboardPlaybackTarget[], durationMs: number, shouldRecord: boolean): Promise<void> => {
    if (!targets.length) return;
    if (shouldRecord) fretboardLooper?.recordPulse(targets.map((target) => target.midi), durationMs);
    const ctx = await ensureAudioContext();
    if (!ctx) return;
    const sample = await ensureFretSample(ctx);
    const startAt = ctx.currentTime + 0.01;
    targets.forEach((target) => {
      if (sample) {
        const source = ctx.createBufferSource();
        source.buffer = sample;
        source.playbackRate.value = Math.pow(2, (target.midi - FRETBOARD_SAMPLE_BASE_MIDI) / 12);
        const gain = ctx.createGain();
        gain.gain.value = FRETBOARD_GAIN;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(startAt);
        source.stop(startAt + durationMs / 1000);
      }
    });
    fretboardUi?.pulseTargets(targets, durationMs);
  };

  const playCircleMidis = async (midis: number[], durationMs: number, shouldRecord: boolean): Promise<void> => {
    if (!midis.length) return;
    if (shouldRecord) circleLooper?.recordPulse(midis, durationMs);
    if (midis.length === 1) {
      const midi = midis[0];
      if (midi === undefined) return;
      circleUi?.pulseNote(midi, durationMs);
      await guitarPlayer.playMidi(midi, durationMs);
      return;
    }
    circleUi?.pulseChord(midis, durationMs);
    await guitarPlayer.playChord(midis, durationMs);
  };

  return {
    id: "wild-tuna",
    title: "Wild Tuna",
    icon: "WT",
    preserveState: false,
    canFullscreen: true,
    onEnter: async () => {
      options.onRandomnessChange?.(0.25);
      if (!drumHost || !circleHost || !circleLooperHost || !fretboardHost) return;

      const drumTemplate = document
        .querySelector<HTMLElement>('#mode-screen-drum-machine .drum-mock')
        ?.cloneNode(true);
      drumHost.replaceChildren();
      if (drumTemplate instanceof HTMLElement) {
        drumHost.appendChild(drumTemplate);
      }
      fretboardHost.innerHTML = createFretboardMarkup();

      circleLooper = createUiCompositeLooper({
        getMeasureDurationMs: () => ((60 / Math.max(1, drumUi?.getBpm() ?? 120)) * 4 * 1000),
        onPlaybackEvent: (event) => {
          void playCircleMidis(event.midis, event.durationMs, false);
        },
      });
      circleLooperHost.replaceChildren(circleLooper.rootEl);

      fretboardLooper = createUiCompositeLooper({
        getMeasureDurationMs: () => ((60 / Math.max(1, drumUi?.getBpm() ?? 120)) * 4 * 1000),
        onPlaybackEvent: (event) => {
          const targets = event.midis.map((midi) => ({ midi, stringIndex: 0 }));
          void playFretTargets(targets, event.durationMs, false);
        },
      });

      drumUi = createDrumMachineUi(drumHost, {
        onTransportStart: () => {
          circleLooper?.onTransportStart();
          fretboardLooper?.onTransportStart();
        },
        onTransportStop: () => {
          circleLooper?.onTransportStop();
          fretboardLooper?.onTransportStop();
        },
        onBeatBoundary: (event) => {
          circleLooper?.onBeatBoundary(event);
          fretboardLooper?.onBeatBoundary(event);
        },
      });

      circleUi = createCircleOfFifthsUi(circleHost, {
        onPrimaryTap: (selection) => {
          void playCircleMidis([selection.primaryMidi], 380, true);
        },
        onOuterTap: (note) => {
          void playCircleMidis(getCircleMajorChordMidis(note.midi), 640, true);
        },
        onSecondaryTap: (chord) => {
          void playCircleMidis(getCircleChordMidis(chord), 640, true);
        },
        onOuterPressStart: (note) => {
          const midis = getCircleMajorChordMidis(note.midi);
          circleLooper?.recordHoldStart(`circle-major-${note.midi}`, midis);
          circleUi?.holdChord(midis);
          void guitarPlayer.startSustainChord(midis);
        },
        onOuterPressEnd: (note) => {
          circleLooper?.recordHoldEnd(`circle-major-${note.midi}`);
          circleUi?.releaseHeldNotes();
          guitarPlayer.stopSustain();
        },
      });
      circleUi.setInstrumentLabel(guitarPlayer.setInstrument("guitar-acoustic"));

      fretboardUi = createFretboardUi(fretboardHost, {
        initialState: FRETBOARD_DEFAULT_STATE,
        onStateChange: (nextState) => {
          fretboardState = nextState;
        },
        onPlayPress: () => {
          const rootMidi = 60;
          void playFretTargets([{ midi: rootMidi, stringIndex: 0, isRoot: true }], 360, true);
        },
        onFretPress: ({ midi, stringIndex, fret }) => {
          if (fretboardState.display === "chord") {
            const chordTargets = getChordTapPlaybackTargets({
              chordRoot: fretboardState.root,
              characteristic: fretboardState.characteristic as CharacteristicType,
              tappedMidi: midi,
              tappedStringIndex: stringIndex,
            });
            void playFretTargets(chordTargets, 560, true);
            return;
          }
          if (fretboardState.display === "key") {
            const keyTargets = getKeyTapPlaybackTargets({
              keyRoot: fretboardState.root,
              keyMode: fretboardState.characteristic,
              tappedMidi: midi,
              tappedStringIndex: stringIndex,
            });
            void playFretTargets(keyTargets, 560, true);
            return;
          }
          void playFretTargets([{ midi, stringIndex, isRoot: fret === 0 }], 360, true);
        },
      });
      fretboardUi.setLooperElement(fretboardLooper.rootEl);
      fretboardUi.enter();
      await drumUi.enter();
    },
    onExit: () => {
      options.onRandomnessChange?.(null);
      guitarPlayer.stopSustain();
      guitarPlayer.stopAll();
      drumUi?.exit();
      drumUi?.destroy();
      drumUi = null;
      circleUi?.destroy();
      circleUi = null;
      circleLooper?.destroy();
      circleLooper = null;
      fretboardUi?.setLooperElement(null);
      fretboardUi?.exit();
      fretboardUi = null;
      fretboardLooper?.destroy();
      fretboardLooper = null;
      if (circleLooperHost) circleLooperHost.replaceChildren();
      if (circleHost) circleHost.replaceChildren();
      if (drumHost) drumHost.replaceChildren();
      if (fretboardHost) fretboardHost.replaceChildren();
    },
  };
}
