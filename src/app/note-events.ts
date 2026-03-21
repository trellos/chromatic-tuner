export type NoteEventOrigin = "live" | "playback";

export type NoteEventSnapshot<Source extends string = string> = {
  noteId: string;
  source: Source;
  midis: number[];
  durationMs: number;
  startedAt: number;
  endAt: number;
  origin: NoteEventOrigin;
};

export type NoteEventInput<Source extends string = string> = {
  source: Source;
  midis: number[];
  durationMs: number;
  startedAt?: number;
  origin?: NoteEventOrigin;
};

export type NoteEventHoldInput<Source extends string = string> = {
  source: Source;
  midis: number[];
  startedAt?: number;
  origin?: NoteEventOrigin;
};

export type NoteEventHub<Source extends string = string> = {
  emitPulse: (event: NoteEventInput<Source>) => string | null;
  startHold: (event: NoteEventHoldInput<Source>) => string | null;
  stopHold: (noteId: string, endAt?: number) => void;
  onNoteOn: (handler: (event: NoteEventSnapshot<Source>) => void) => () => void;
  onNoteOff: (handler: (event: NoteEventSnapshot<Source>) => void) => () => void;
  getActiveNotes: () => NoteEventSnapshot<Source>[];
  reset: () => void;
};

type NoteTimeoutId = ReturnType<typeof globalThis.setTimeout>;

type NoteEventHubOptions = {
  now?: () => number;
  setTimeoutFn?: (handler: () => void, delayMs: number) => NoteTimeoutId;
  clearTimeoutFn?: (id: NoteTimeoutId) => void;
};

function sanitizeMidis(midis: number[]): number[] {
  return midis
    .map((value) => Math.round(value))
    .filter((value) => Number.isFinite(value));
}

export function createNoteEventHub<Source extends string = string>(
  options: NoteEventHubOptions = {}
): NoteEventHub<Source> {
  const now = options.now ?? (() => performance.now());
  const setTimeoutFn = options.setTimeoutFn ?? ((handler: () => void, delayMs: number) => globalThis.setTimeout(handler, delayMs));
  const clearTimeoutFn = options.clearTimeoutFn ?? ((id: NoteTimeoutId) => globalThis.clearTimeout(id));
  const noteOnHandlers = new Set<(event: NoteEventSnapshot<Source>) => void>();
  const noteOffHandlers = new Set<(event: NoteEventSnapshot<Source>) => void>();
  const activeNotes = new Map<string, NoteEventSnapshot<Source>>();
  const endTimeoutIds = new Map<string, NoteTimeoutId>();
  let nextNoteId = 0;

  const finalizeNote = (noteId: string, endAt = now()): void => {
    const snapshot = activeNotes.get(noteId);
    if (!snapshot) return;
    const timeoutId = endTimeoutIds.get(noteId);
    if (timeoutId !== undefined) {
      clearTimeoutFn(timeoutId);
      endTimeoutIds.delete(noteId);
    }
    activeNotes.delete(noteId);
    noteOffHandlers.forEach((handler) => handler({
      ...snapshot,
      durationMs: Math.max(0, endAt - snapshot.startedAt),
      endAt,
    }));
  };

  return {
    emitPulse(event) {
      const midis = sanitizeMidis(event.midis);
      if (!midis.length) return null;
      const startedAt = event.startedAt ?? now();
      const durationMs = Math.max(0, event.durationMs);
      const noteId = `note-${nextNoteId++}`;
      const snapshot: NoteEventSnapshot<Source> = {
        noteId,
        source: event.source,
        midis,
        durationMs,
        startedAt,
        endAt: startedAt + durationMs,
        origin: event.origin ?? "playback",
      };
      activeNotes.set(noteId, snapshot);
      noteOnHandlers.forEach((handler) => handler(snapshot));
      const timeoutId = setTimeoutFn(() => finalizeNote(noteId), durationMs);
      endTimeoutIds.set(noteId, timeoutId);
      return noteId;
    },
    startHold(event) {
      const midis = sanitizeMidis(event.midis);
      if (!midis.length) return null;
      const startedAt = event.startedAt ?? now();
      const noteId = `hold-${nextNoteId++}`;
      const snapshot: NoteEventSnapshot<Source> = {
        noteId,
        source: event.source,
        midis,
        durationMs: 0,
        startedAt,
        endAt: startedAt,
        origin: event.origin ?? "live",
      };
      activeNotes.set(noteId, snapshot);
      noteOnHandlers.forEach((handler) => handler(snapshot));
      return noteId;
    },
    stopHold(noteId, endAt = now()) {
      finalizeNote(noteId, endAt);
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
      return [...activeNotes.values()].sort((a, b) => a.startedAt - b.startedAt);
    },
    reset() {
      endTimeoutIds.forEach((timeoutId) => clearTimeoutFn(timeoutId));
      endTimeoutIds.clear();
      activeNotes.clear();
    },
  };
}
