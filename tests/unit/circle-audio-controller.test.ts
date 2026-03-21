import { describe, expect, it, vi } from "vitest";
import { createCircleAudioController } from "../../src/app/circle-audio-controller.js";
import type { CircleOfFifthsUi } from "../../src/ui/circle-of-fifths.js";

function createUiStub(): CircleOfFifthsUi {
  return {
    setPrimaryByLabel: () => undefined,
    setPrimaryByMidi: () => undefined,
    setTuningCents: () => undefined,
    setMinorMode: () => undefined,
    setInstrumentLabel: () => undefined,
    showInnerIndicator: () => undefined,
    pulseNote: vi.fn(),
    pulseChord: vi.fn(),
    holdNote: vi.fn(),
    holdChord: vi.fn(),
    releaseHeldNotes: vi.fn(),
    destroy: () => undefined,
  };
}

describe("circle-audio-controller", () => {
  it("routes pointerdown pulses through UI visuals and player immediately", () => {
    const ui = createUiStub();
    const player = {
      playMidi: vi.fn(),
      playChord: vi.fn(),
      startSustainMidi: vi.fn(),
      startSustainChord: vi.fn(),
      stopSustain: vi.fn(),
      cycleInstrument: vi.fn(() => "ELECTRIC GUITAR"),
      setInstrument: vi.fn(() => "ACOUSTIC GUITAR"),
      getInstrumentName: vi.fn(() => "ACOUSTIC GUITAR"),
      preloadCurrentInstrument: vi.fn(),
      stopAll: vi.fn(),
      destroy: vi.fn(),
    };
    const controller = createCircleAudioController({ player, getUi: () => ui });
    const interactions = controller.getInteractionOptions();

    interactions.onOuterTap?.({
      index: 0,
      label: "C",
      midi: 60,
      isPrimary: false,
      zone: "note",
      movesPrimary: false,
    });

    expect(ui.pulseNote).toHaveBeenCalledWith(60, 400);
    expect(player.playMidi).toHaveBeenCalledWith(60, 400);
  });

  it("suppresses tap re-attack after a hold start and releases the sustain on background tap", () => {
    const ui = createUiStub();
    const player = {
      playMidi: vi.fn(),
      playChord: vi.fn(),
      startSustainMidi: vi.fn(),
      startSustainChord: vi.fn(),
      stopSustain: vi.fn(),
      cycleInstrument: vi.fn(() => "ELECTRIC GUITAR"),
      setInstrument: vi.fn(() => "ACOUSTIC GUITAR"),
      getInstrumentName: vi.fn(() => "ACOUSTIC GUITAR"),
      preloadCurrentInstrument: vi.fn(),
      stopAll: vi.fn(),
      destroy: vi.fn(),
    };
    const controller = createCircleAudioController({ player, getUi: () => ui });
    const interactions = controller.getInteractionOptions();

    interactions.onOuterPressStart?.({
      index: 0,
      label: "C",
      midi: 60,
      isPrimary: false,
      zone: "note",
      movesPrimary: false,
    });
    interactions.onOuterTap?.({
      index: 0,
      label: "C",
      midi: 60,
      isPrimary: false,
      zone: "note",
      movesPrimary: false,
    });
    interactions.onBackgroundTap?.();

    expect(player.startSustainMidi).toHaveBeenCalledWith(60);
    expect(player.playMidi).not.toHaveBeenCalled();
    expect(player.stopSustain).toHaveBeenCalled();
    expect(ui.releaseHeldNotes).toHaveBeenCalled();
  });
});
