import { createCircleGuitarPlayer } from "../audio/circle-guitar-player.js";
import { createCircleOfFifthsUi, getCircleChordMidis, getCircleMajorChordMidis } from "../ui/circle-of-fifths.js";
import { createDrumMachineUi } from "../ui/drum-machine.js";
import { createFretboardUi } from "../ui/fretboard.js";
import {
  getChordTapPlaybackTargets,
  getKeyTapPlaybackTargets,
  NOTE_TO_SEMITONE,
  FRETBOARD_DEFAULT_STATE,
  type CharacteristicType,
  type FretboardPlaybackTarget,
  type FretboardState,
} from "../fretboard-logic.js";
import {
  FRETBOARD_SAMPLE_BASE_MIDI,
  FRETBOARD_SAMPLE_GAIN,
  fetchFretboardSample,
} from "../audio/fretboard-sample.js";
import { createUiCompositeLooper } from "../ui/ui-composite-looper.js";
import { getOrCreateAudioContext } from "../utils.js";
import type { ModeDefinition } from "./types.js";

type WildTunaModeOptions = {
  onRandomnessChange?: (randomness: number | null) => void;
};


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

  const ensureAudioContext = async (): Promise<AudioContext | null> => {
    audioContext = await getOrCreateAudioContext(audioContext);
    return audioContext;
  };

  const ensureFretSample = async (ctx: AudioContext): Promise<AudioBuffer | null> => {
    if (fretSample) return fretSample;
    fretSample = await fetchFretboardSample(ctx);
    return fretSample;
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
        gain.gain.value = FRETBOARD_SAMPLE_GAIN;
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
      const fretboardTemplate = document.querySelector<HTMLTemplateElement>("#fretboard-template");
      fretboardHost.replaceChildren(
        fretboardTemplate ? fretboardTemplate.content.cloneNode(true) : document.createDocumentFragment()
      );

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
        onSecondaryPressStart: (chord) => {
          const chordMidis = getCircleChordMidis(chord);
          circleLooper?.recordHoldStart(`circle-secondary-${chord.rootMidi}`, chordMidis);
          circleUi?.holdChord(chordMidis);
          void guitarPlayer.startSustainChord(chordMidis);
        },
        onSecondaryPressEnd: (chord) => {
          circleLooper?.recordHoldEnd(`circle-secondary-${chord.rootMidi}`);
          circleUi?.releaseHeldNotes();
          guitarPlayer.stopSustain();
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
        controlsHidden: true,
        onStateChange: (nextState) => {
          fretboardState = nextState;
        },
        onPlayPress: () => {
          const rootMidi = FRETBOARD_SAMPLE_BASE_MIDI + (NOTE_TO_SEMITONE[fretboardState.root] ?? 0);
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
