export type TransportBeatEvent = {
  beatIndex: number;
  beatHasSound: boolean;
  soundingBeatIndices: number[];
  beatsPerBar: number;
  scheduledTimeSec: number;
  scheduledPerfMs: number;
};

export type SessionTransport = {
  onStart: (handler: () => void) => () => void;
  onStop: (handler: () => void) => () => void;
  onBeatBoundary: (handler: (event: TransportBeatEvent) => void) => () => void;
  notifyStart: () => void;
  notifyStop: () => void;
  notifyBeatBoundary: (event: TransportBeatEvent) => void;
  isPlaying: () => boolean;
  getMeasureIndex: () => number;
  setMeasureIndexBeforeNextBoundary: (measureIndex: number, measureCount: number) => void;
};

// Central transport/session bus for modes that coordinate multiple playback UIs.
// Invariant: measureIndex only advances on beatIndex===0 boundaries, and explicit
// seek uses setMeasureIndexBeforeNextBoundary() so next boundary lands on target.
export function createSessionTransport(): SessionTransport {
  const startHandlers = new Set<() => void>();
  const stopHandlers = new Set<() => void>();
  const beatHandlers = new Set<(event: TransportBeatEvent) => void>();

  let playing = false;
  let measureIndex = -1;

  const subscribe = <T>(set: Set<T>, handler: T): (() => void) => {
    set.add(handler);
    return () => set.delete(handler);
  };

  return {
    onStart: (handler) => subscribe(startHandlers, handler),
    onStop: (handler) => subscribe(stopHandlers, handler),
    onBeatBoundary: (handler) => subscribe(beatHandlers, handler),
    notifyStart: () => {
      playing = true;
      measureIndex = -1;
      startHandlers.forEach((handler) => handler());
    },
    notifyStop: () => {
      playing = false;
      measureIndex = -1;
      stopHandlers.forEach((handler) => handler());
    },
    notifyBeatBoundary: (event) => {
      if (event.beatIndex === 0) {
        measureIndex += 1;
      }
      beatHandlers.forEach((handler) => handler(event));
    },
    isPlaying: () => playing,
    getMeasureIndex: () => measureIndex,
    setMeasureIndexBeforeNextBoundary: (targetMeasureIndex, measureCount) => {
      const safeCount = Math.max(1, Math.round(measureCount));
      measureIndex = (targetMeasureIndex - 1 + safeCount) % safeCount;
    },
  };
}
