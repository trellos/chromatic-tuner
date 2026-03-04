import { describe, expect, it, vi } from "vitest";
import { createSessionTransport, type TransportBeatEvent } from "../../src/app/session-transport.js";

const BEAT_EVENT: TransportBeatEvent = {
  beatIndex: 0,
  beatHasSound: true,
  soundingBeatIndices: [0, 4, 8, 12],
  beatsPerBar: 4,
  scheduledTimeSec: 0,
  scheduledPerfMs: 0,
};

describe("session-transport", () => {
  it("notifies start/stop and resets measure index", () => {
    const transport = createSessionTransport();
    const onStart = vi.fn();
    const onStop = vi.fn();
    transport.onStart(onStart);
    transport.onStop(onStop);

    transport.notifyStart();
    expect(transport.isPlaying()).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);

    transport.notifyBeatBoundary(BEAT_EVENT);
    expect(transport.getMeasureIndex()).toBe(0);

    transport.notifyStop();
    expect(transport.isPlaying()).toBe(false);
    expect(transport.getMeasureIndex()).toBe(-1);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("advances measure index only on beat zero and supports pre-seek", () => {
    const transport = createSessionTransport();
    transport.notifyStart();
    transport.notifyBeatBoundary({ ...BEAT_EVENT, beatIndex: 1 });
    expect(transport.getMeasureIndex()).toBe(-1);

    transport.setMeasureIndexBeforeNextBoundary(3, 4);
    expect(transport.getMeasureIndex()).toBe(2);

    transport.notifyBeatBoundary({ ...BEAT_EVENT, beatIndex: 0 });
    expect(transport.getMeasureIndex()).toBe(3);
  });
});
