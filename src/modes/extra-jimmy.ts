import { createFretboardUi } from "../ui/fretboard.js";
import {
  getDiatonicHarmonyMidi,
  getIntervals,
  NOTE_TO_SEMITONE,
  FRETBOARD_DEFAULT_STATE,
  type FretboardPlaybackTarget,
  type FretboardState,
  type KeyModeType,
  type NoteName,
} from "../fretboard-logic.js";
import {
  FRETBOARD_SAMPLE_BASE_MIDI,
  FRETBOARD_SAMPLE_GAIN,
  fetchFretboardSample,
} from "../audio/fretboard-sample.js";
import { getOrCreateAudioContext } from "../utils.js";
import type { ModeDefinition } from "./types.js";

export function createExtraJimmyMode(): ModeDefinition {
  // Find the mode container in the DOM. Return a stub if not present (fallback for tests/edge cases).
  const modeEl = document.querySelector<HTMLElement>('.mode-screen[data-mode="extra-jimmy"]');
  if (!modeEl)
    return { id: "extra-jimmy", title: "Extra Jimmy" };

  // Cache DOM references for both fretboards and all control elements.
  const lowViewport = modeEl.querySelector<HTMLElement>(
    '[data-ej-neck="low"] .ej-neck-viewport'
  );
  const highViewport = modeEl.querySelector<HTMLElement>(
    '[data-ej-neck="high"] .ej-neck-viewport'
  );
  const lowWrapper = modeEl.querySelector<HTMLElement>('[data-ej-neck="low"]');
  const highWrapper = modeEl.querySelector<HTMLElement>('[data-ej-neck="high"]');
  const harmonySelect = modeEl.querySelector<HTMLSelectElement>("[data-ej-harmony]");
  const scaleSelect = modeEl.querySelector<HTMLSelectElement>("[data-ej-scale]");
  const keyTrigger = modeEl.querySelector<HTMLButtonElement>("[data-ej-key-trigger]");
  const zoomTargetButton = modeEl.querySelector<HTMLButtonElement>("[data-ej-zoom-target]");
  const keyPopup = modeEl.querySelector<HTMLElement>("[data-ej-key-popup]");
  const keyNoteButtons = modeEl.querySelectorAll<HTMLButtonElement>("[data-ej-key-note]");

  // Mode state: UIs, audio context, and a fret sample buffer are lazily initialized on mode enter.
  let modeAbort: AbortController | null = null;
  let lowUi: ReturnType<typeof createFretboardUi> | null = null;
  let highUi: ReturnType<typeof createFretboardUi> | null = null;
  let audioCtx: AudioContext | null = null;
  let fretSample: AudioBuffer | null = null;

  // Shared state: both boards always display in "key" mode and start in C Major.
  let boardState: FretboardState = {
    ...FRETBOARD_DEFAULT_STATE,
    display: "key",
    characteristic: "ionian-major",
  };
  // Harmony interval controls how many scale degrees to jump when calculating the partner note.
  let stepsAbove = 2;
  let zoomArmed = false;

  const ensureAudio = async () => {
    audioCtx = await getOrCreateAudioContext(audioCtx);
    return audioCtx;
  };
  const ensureSample = async (ctx: AudioContext) => {
    fretSample ??= await fetchFretboardSample(ctx);
    return fretSample;
  };

  const playMidi = (
    ctx: AudioContext,
    sample: AudioBuffer | null,
    midi: number,
    t: number,
    ms: number
  ) => {
    if (!sample) return;
    const src = ctx.createBufferSource();
    src.buffer = sample;
    src.playbackRate.value = Math.pow(2, (midi - FRETBOARD_SAMPLE_BASE_MIDI) / 12);
    const gain = ctx.createGain();
    gain.gain.value = FRETBOARD_SAMPLE_GAIN;
    src.connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + ms / 1000);
  };

  const playBoth = async (midiA: number, midiB: number, ms: number) => {
    const ctx = await ensureAudio();
    if (!ctx) return;
    const sample = await ensureSample(ctx);
    const t = ctx.currentTime + 0.01;
    playMidi(ctx, sample, midiA, t, ms);
    playMidi(ctx, sample, midiB, t, ms);
  };

  const harmonyOf = (midi: number, steps: number) =>
    getDiatonicHarmonyMidi(
      midi,
      steps,
      NOTE_TO_SEMITONE[boardState.root] ?? 0,
      getIntervals("key", boardState.characteristic)
    );

  // Pulse harmony on partner board using midi-only fallback
  const pulseHarmony = (ui: ReturnType<typeof createFretboardUi> | null, midi: number, ms: number) =>
    ui?.pulseTargets([{ midi, stringIndex: -1 }], ms);

  const setActiveNeck = (which: "low" | "high") => {
    lowWrapper?.classList.toggle("is-active", which === "low");
    highWrapper?.classList.toggle("is-active", which === "high");
  };

  const syncBoards = () => {
    lowUi?.render(boardState);
    highUi?.render(boardState);
  };

  const syncZoomArmVisual = () => {
    if (!zoomTargetButton) return;
    zoomTargetButton.classList.toggle("is-active", zoomArmed);
    zoomTargetButton.setAttribute("aria-pressed", String(zoomArmed));
    zoomTargetButton.textContent = zoomArmed ? "TARGET ON" : "TARGET";
  };

  const setSharedZoomArmed = (armed: boolean, clearExistingZoom = false) => {
    if (zoomArmed === armed) {
      if (clearExistingZoom && !armed) {
        lowUi?.clearZoom();
        highUi?.clearZoom();
      }
      return;
    }
    zoomArmed = armed;
    lowUi?.setZoomArmed(armed);
    highUi?.setZoomArmed(armed);
    if (!armed && clearExistingZoom) {
      lowUi?.clearZoom();
      highUi?.clearZoom();
    }
    syncZoomArmVisual();
  };

  const onBoardZoomArmChanged = (armed: boolean) => {
    if (!armed && zoomArmed) {
      setSharedZoomArmed(false);
    }
  };

  const isPopupOpen = () => !keyPopup?.hasAttribute("hidden");
  const openPopup = () => {
    keyPopup?.removeAttribute("hidden");
    keyTrigger?.setAttribute("aria-expanded", "true");
    keyTrigger?.classList.add("is-open");
    keyNoteButtons.forEach((b) =>
      b.classList.toggle("is-active", b.dataset.ejKeyNote === boardState.root)
    );
  };
  const closePopup = () => {
    keyPopup?.setAttribute("hidden", "");
    keyTrigger?.setAttribute("aria-expanded", "false");
    keyTrigger?.classList.remove("is-open");
  };

  return {
    id: "extra-jimmy",
    title: "Extra Jimmy",
    preserveState: false,

    onEnter: () => {
      // Kill any previous abort signals and create a fresh one for this mode session.
      modeAbort?.abort();
      modeAbort = new AbortController();
      const { signal } = modeAbort;
      if (!lowViewport || !highViewport) return;

      // Clone the #fretboard-template into each viewport. Remove duplicate element IDs
      // so the FretboardUi instances can find their controls without conflicts.
      const template = document.querySelector<HTMLTemplateElement>("#fretboard-template");
      const cloneInto = (host: HTMLElement) => {
        host.replaceChildren(
          template ? template.content.cloneNode(true) : document.createDocumentFragment()
        );
        host.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
      };
      cloneInto(lowViewport);
      cloneInto(highViewport);

      // Create both FretboardUi instances with shared state and per-fretboard press handlers.
      lowUi = createFretboardUi(lowViewport, {
        initialState: { ...boardState },
        fretPressEvent: "pointerdown",
        showControls: false,
        showZoomControl: false,
        onZoomArmedChange: onBoardZoomArmChanged,
        onFretPress: ({ midi, stringIndex }) => {
          // Tapping the low fretboard: play the note + its harmony partner above on the high board.
          const harmony = harmonyOf(midi, stepsAbove);
          void playBoth(midi, harmony, 420);
          lowUi?.pulseTargets([{ midi, stringIndex }], 420);
          pulseHarmony(highUi, harmony, 420);
          setActiveNeck("low");
        },
      });
      highUi = createFretboardUi(highViewport, {
        initialState: { ...boardState },
        fretPressEvent: "pointerdown",
        showControls: false,
        showZoomControl: false,
        onZoomArmedChange: onBoardZoomArmChanged,
        onFretPress: ({ midi, stringIndex }) => {
          // Tapping the high fretboard: play the note + its harmony partner below on the low board (negative steps).
          const harmony = harmonyOf(midi, -stepsAbove);
          void playBoth(midi, harmony, 420);
          highUi?.pulseTargets([{ midi, stringIndex }], 420);
          pulseHarmony(lowUi, harmony, 420);
          setActiveNeck("high");
        },
      });

      lowUi.enter();
      highUi.enter();
      syncZoomArmVisual();

      // Wire control event listeners. All listeners are tied to the abort signal so they
      // are cleaned up on mode exit.

      zoomTargetButton?.addEventListener(
        "click",
        () => {
          setSharedZoomArmed(!zoomArmed, zoomArmed);
        },
        { signal }
      );

      // Harmony interval selector: updates the scale degree jump for partner note calculation.
      harmonySelect?.addEventListener(
        "change",
        () => {
          stepsAbove = Number.parseInt(harmonySelect.value, 10);
        },
        { signal }
      );

      // Scale/mode selector: both boards re-render with the new scale.
      scaleSelect?.addEventListener(
        "change",
        () => {
          boardState = {
            ...boardState,
            characteristic: scaleSelect.value as KeyModeType,
          };
          syncBoards();
        },
        { signal }
      );

      // Key button: toggles the key selection popup open/closed.
      keyTrigger?.addEventListener(
        "click",
        (e) => {
          e.stopPropagation();
          isPopupOpen() ? closePopup() : openPopup();
        },
        { signal }
      );

      // Key note buttons: each selects a root note, updates both boards, and closes the popup.
      keyNoteButtons.forEach((btn) =>
        btn.addEventListener(
          "click",
          () => {
            const note = btn.dataset.ejKeyNote as NoteName | undefined;
            if (!note) return;
            boardState = { ...boardState, root: note };
            if (keyTrigger) {
              keyTrigger.textContent = note;
              keyTrigger.setAttribute("aria-label", `Select key: ${note}`);
            }
            syncBoards();
            closePopup();
          },
          { signal }
        )
      );

      // Close popup on any document click outside it. The key button's stopPropagation
      // prevents this from immediately closing after the button opens the popup.
      document.addEventListener(
        "click",
        () => {
          if (isPopupOpen()) closePopup();
        },
        { signal }
      );
    },

    onExit: () => {
      // Abort all pending timers and event listeners tied to this mode session.
      modeAbort?.abort();
      modeAbort = null;

      // Shut down both fretboard UI instances and clear references.
      setSharedZoomArmed(false, true);
      lowUi?.exit();
      highUi?.exit();
      lowUi = null;
      highUi = null;
      zoomArmed = false;
      syncZoomArmVisual();

      // Clear the viewport DOM to remove all cloned fretboard elements.
      if (lowViewport) lowViewport.replaceChildren();
      if (highViewport) highViewport.replaceChildren();

      // Clean up UI state and release audio resources.
      closePopup();
      void audioCtx?.close();
      audioCtx = null;
      fretSample = null;
    },
  };
}
