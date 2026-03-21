import {
  createNoteEventHub,
  type NoteEventHub,
  type NoteEventOrigin,
  type NoteEventSnapshot,
} from "./note-events.js";

export type AudioSessionInstrumentId = string;

export type AudioSessionInstrument<InstrumentId extends string = string> = {
  playPulse: (midis: number[], durationMs: number) => void | Promise<void>;
  startHold: (midis: number[]) => void | Promise<void>;
  stopHold: () => void | Promise<void>;
  stopAll?: () => void | Promise<void>;
};

export type AudioSessionNoteEvent<
  InstrumentId extends string = string,
  Source extends string = string,
> = NoteEventSnapshot<`${InstrumentId}:${Source}`>;

export type AudioSession<InstrumentId extends string = string, Source extends string = string> = {
  registerInstrument: (id: InstrumentId, instrument: AudioSessionInstrument<InstrumentId>) => void;
  playPulse: (event: AudioSessionPlayPulseInput<InstrumentId, Source>) => string | null;
  startHold: (event: AudioSessionHoldInput<InstrumentId, Source>) => string | null;
  stopHold: (noteId: string) => void;
  releaseInstrument: (instrumentId: InstrumentId) => void;
  releaseAll: () => void;
  stopAll: () => void;
  onNoteOn: (handler: (event: AudioSessionNoteEvent<InstrumentId, Source>) => void) => () => void;
  onNoteOff: (handler: (event: AudioSessionNoteEvent<InstrumentId, Source>) => void) => () => void;
  getActiveNotes: () => AudioSessionNoteEvent<InstrumentId, Source>[];
};

export type AudioSessionPlayPulseInput<InstrumentId extends string = string, Source extends string = string> = {
  instrumentId: InstrumentId;
  source: Source;
  midis: number[];
  durationMs: number;
  startedAt?: number;
  origin?: NoteEventOrigin;
};

export type AudioSessionHoldInput<InstrumentId extends string = string, Source extends string = string> = {
  instrumentId: InstrumentId;
  source: Source;
  midis: number[];
  startedAt?: number;
  origin?: NoteEventOrigin;
};

type HoldSnapshot<InstrumentId extends string, Source extends string> = AudioSessionNoteEvent<InstrumentId, Source>;

type NoteTimeoutId = ReturnType<typeof globalThis.setTimeout>;

type AudioSessionOptions = {
  now?: () => number;
  setTimeoutFn?: (handler: () => void, delayMs: number) => NoteTimeoutId;
  clearTimeoutFn?: (id: NoteTimeoutId) => void;
  noteEvents?: NoteEventHub<string>;
};

function createSessionSource<InstrumentId extends string, Source extends string>(
  instrumentId: InstrumentId,
  source: Source
): `${InstrumentId}:${Source}` {
  return `${instrumentId}:${source}`;
}

export function createAudioSession<InstrumentId extends string = string, Source extends string = string>(
  options: AudioSessionOptions = {}
): AudioSession<InstrumentId, Source> {
  const now = options.now ?? (() => performance.now());
  const noteEvents = (options.noteEvents as NoteEventHub<`${InstrumentId}:${Source}`> | undefined)
    ?? createNoteEventHub<`${InstrumentId}:${Source}`>({
      now,
      ...(options.setTimeoutFn === undefined ? {} : { setTimeoutFn: options.setTimeoutFn }),
      ...(options.clearTimeoutFn === undefined ? {} : { clearTimeoutFn: options.clearTimeoutFn }),
    });
  const instruments = new Map<InstrumentId, AudioSessionInstrument<InstrumentId>>();
  const holdHandlers = new Map<string, HoldSnapshot<InstrumentId, Source>>();
  const noteOnHandlers = new Set<(event: AudioSessionNoteEvent<InstrumentId, Source>) => void>();
  const noteOffHandlers = new Set<(event: AudioSessionNoteEvent<InstrumentId, Source>) => void>();
  let nextHoldId = 0;

  noteEvents.onNoteOn((event) => {
    noteOnHandlers.forEach((handler) => handler(event as AudioSessionNoteEvent<InstrumentId, Source>));
  });
  noteEvents.onNoteOff((event) => {
    noteOffHandlers.forEach((handler) => handler(event as AudioSessionNoteEvent<InstrumentId, Source>));
  });

  const getInstrument = (instrumentId: InstrumentId): AudioSessionInstrument<InstrumentId> => {
    const instrument = instruments.get(instrumentId);
    if (!instrument) {
      throw new Error(`Audio session instrument not registered: ${instrumentId}`);
    }
    return instrument;
  };

  const emitHoldOff = (noteId: string): void => {
    const snapshot = holdHandlers.get(noteId);
    if (!snapshot) return;
    holdHandlers.delete(noteId);
    noteOffHandlers.forEach((handler) => handler(snapshot));
  };

  return {
    registerInstrument(id, instrument) {
      instruments.set(id, instrument);
    },
    playPulse(event) {
      const instrument = getInstrument(event.instrumentId);
      // Fire the instrument path before notifying subscribers so visual listeners
      // never sit in front of pointerdown audio onset.
      void instrument.playPulse(event.midis, event.durationMs);
      return noteEvents.emitPulse({
        source: createSessionSource(event.instrumentId, event.source),
        midis: event.midis,
        durationMs: event.durationMs,
        ...(event.startedAt === undefined ? {} : { startedAt: event.startedAt }),
        origin: event.origin ?? "live",
      });
    },
    startHold(event) {
      const instrument = getInstrument(event.instrumentId);
      void instrument.startHold(event.midis);
      const midis = event.midis.map((value) => Math.round(value)).filter((value) => Number.isFinite(value));
      if (!midis.length) return null;
      const startedAt = event.startedAt ?? now();
      const noteId = `hold-${nextHoldId++}`;
      const snapshot: HoldSnapshot<InstrumentId, Source> = {
        noteId,
        source: createSessionSource(event.instrumentId, event.source),
        midis,
        durationMs: 0,
        startedAt,
        endAt: startedAt,
        origin: event.origin ?? "live",
      };
      holdHandlers.set(noteId, snapshot);
      noteOnHandlers.forEach((handler) => handler(snapshot));
      return noteId;
    },
    stopHold(noteId) {
      const snapshot = holdHandlers.get(noteId);
      if (!snapshot) return;
      const [instrumentId] = snapshot.source.split(":", 1) as [InstrumentId];
      void instruments.get(instrumentId)?.stopHold();
      emitHoldOff(noteId);
    },
    releaseInstrument(instrumentId) {
      void instruments.get(instrumentId)?.stopHold();
      for (const [noteId, snapshot] of holdHandlers.entries()) {
        if (snapshot.source.startsWith(`${instrumentId}:`)) {
          emitHoldOff(noteId);
        }
      }
    },
    releaseAll() {
      instruments.forEach((instrument) => {
        void instrument.stopHold();
      });
      for (const noteId of [...holdHandlers.keys()]) {
        emitHoldOff(noteId);
      }
    },
    stopAll() {
      noteEvents.reset();
      for (const noteId of [...holdHandlers.keys()]) {
        emitHoldOff(noteId);
      }
      instruments.forEach((instrument) => {
        void instrument.stopAll?.();
        void instrument.stopHold();
      });
    },
    onNoteOn(handler) {
      noteOnHandlers.add(handler);
      return () => noteOnHandlers.delete(handler);
    },
    onNoteOff(handler) {
      noteOffHandlers.add(handler);
      return () => noteOffHandlers.delete(handler);
    },
    getActiveNotes() {
      return [
        ...noteEvents.getActiveNotes(),
        ...holdHandlers.values(),
      ].sort((a, b) => a.startedAt - b.startedAt) as AudioSessionNoteEvent<InstrumentId, Source>[];
    },
  };
}
