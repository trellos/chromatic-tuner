export type CircleNoteBarNote = {
  label: string;
  midi: number;
};

export type CircleNoteBarDegreeToken = "I" | "ii" | "iii" | "IV" | "V" | "vi" | "vii°";
export type CircleNoteBarDegreeKey = "i" | "ii" | "iii" | "iv" | "v" | "vi" | "vii";

export type CircleNoteBarUiOptions = {
  onTap?: (note: CircleNoteBarNote) => void;
  onPressStart?: (note: CircleNoteBarNote) => void;
  onPressEnd?: (note: CircleNoteBarNote) => void;
  onPulseRequest?: () => void;
  onRandomnessRequest?: (randomness: number) => void;
  degreeLabelForMode: (token: CircleNoteBarDegreeToken | null) => string;
  degreeTokenForInterval: (interval: number) => CircleNoteBarDegreeToken | null;
  degreeKeyFromToken: (token: CircleNoteBarDegreeToken) => CircleNoteBarDegreeKey;
};

export type CircleNoteBarUi = {
  element: HTMLDivElement;
  pulseNote: (midi: number, durationMs?: number) => void;
  pulseChord: (midis: number[], durationMs?: number) => void;
  holdNote: (midi: number) => void;
  holdChord: (midis: number[]) => void;
  releaseHeldNotes: () => void;
  updateDegrees: (primarySemitone: number | null) => void;
  destroy: () => void;
};

type NoteCellEntry = {
  row: HTMLDivElement;
  cell: HTMLDivElement;
  degree: HTMLSpanElement;
};

const TRAIL_FLOAT_DISTANCE_PX = 560;
const TRAIL_FLOAT_DURATION_MS = 2000;
const TRAIL_PIXELS_PER_MS = TRAIL_FLOAT_DISTANCE_PX / TRAIL_FLOAT_DURATION_MS;
const NOTE_BAR_ORDER_SEMITONES = [9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
const NOTE_BAR_LABELS = ["A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab"] as const;

function wrap(value: number): number {
  return ((value % 12) + 12) % 12;
}

function midiFromSemitoneNearC4(semitone: number): number {
  return 60 + wrap(semitone);
}

export function createCircleNoteBar(options: CircleNoteBarUiOptions): CircleNoteBarUi {
  const noteBar = document.createElement("div");
  noteBar.className = "cof-note-bar";

  const noteCells = new Map<number, NoteCellEntry>();
  const notePulseTimeouts = new Map<number, number>();
  const noteTrailCleanupTimeouts = new Set<number>();
  const heldNoteSemitones = new Set<number>();
  const activeNoteTrails = new Map<number, HTMLSpanElement>();
  const noteTrailNodes = new Set<HTMLSpanElement>();

  const clearNoteTimers = (semitone: number): void => {
    const pulseTimeout = notePulseTimeouts.get(semitone);
    if (pulseTimeout !== undefined) {
      window.clearTimeout(pulseTimeout);
      notePulseTimeouts.delete(semitone);
    }
  };

  const removeTrailNode = (trail: HTMLSpanElement): void => {
    trail.remove();
    noteTrailNodes.delete(trail);
    activeNoteTrails.forEach((activeTrail, semitone) => {
      if (activeTrail === trail) activeNoteTrails.delete(semitone);
    });
  };

  const floatTrailNode = (trail: HTMLSpanElement): void => {
    const frozenWidth = trail.getBoundingClientRect().width;
    if (Number.isFinite(frozenWidth) && frozenWidth > 0) {
      trail.style.width = `${frozenWidth.toFixed(2)}px`;
    }
    trail.style.transform = "translateX(0) scaleX(1)";
    trail.classList.remove("is-stretching");
    void trail.getBoundingClientRect();
    trail.classList.add("is-floating");
    const floatTimeout = window.setTimeout(() => {
      removeTrailNode(trail);
      noteTrailCleanupTimeouts.delete(floatTimeout);
    }, TRAIL_FLOAT_DURATION_MS);
    noteTrailCleanupTimeouts.add(floatTimeout);
  };

  const startTrail = (semitone: number, held: boolean): void => {
    const entry = noteCells.get(semitone);
    if (!entry) return;
    const previousTrail = activeNoteTrails.get(semitone);
    if (previousTrail) floatTrailNode(previousTrail);

    const trail = document.createElement("span");
    trail.className = "cof-note-trail";
    const rowWidthPx = Math.max(1, entry.row.clientWidth);
    const cellWidthPx = Math.max(1, entry.cell.offsetWidth);
    const cellHeightPx = Math.max(1, entry.cell.offsetHeight);
    // Held trails overscan farther than short pulses so long sustains can keep
    // stretching without clipping before release freezes the width.
    const growthPx = held ? 1180 : 640;
    const deltaPx = Math.max(0, growthPx - cellWidthPx);
    const stretchMs = Math.max(180, deltaPx / TRAIL_PIXELS_PER_MS);
    const initialWidthPx = Math.max(8, Math.min(cellWidthPx * 0.42, 36));
    const initialScale = Math.max(0.01, Math.min(1, initialWidthPx / growthPx));
    trail.style.setProperty("--cof-note-trail-stretch-ms", `${stretchMs.toFixed(0)}ms`);
    trail.style.setProperty("--cof-note-trail-growth", `${growthPx.toFixed(0)}px`);
    trail.style.setProperty("--cof-note-trail-initial-scale", `${initialScale.toFixed(4)}`);
    trail.style.width = `${growthPx.toFixed(2)}px`;
    trail.style.height = `${cellHeightPx.toFixed(2)}px`;
    trail.style.top = `${entry.cell.offsetTop}px`;
    trail.style.right = `${Math.max(0, rowWidthPx - entry.cell.offsetLeft).toFixed(2)}px`;
    trail.style.borderRadius = getComputedStyle(entry.cell).borderRadius;
    entry.row.appendChild(trail);
    void trail.getBoundingClientRect();
    trail.classList.add("is-stretching");
    activeNoteTrails.set(semitone, trail);
    noteTrailNodes.add(trail);
  };

  const floatTrail = (semitone: number): void => {
    const trail = activeNoteTrails.get(semitone);
    if (!trail) return;
    activeNoteTrails.delete(semitone);
    floatTrailNode(trail);
  };

  const startNoteVisual = (semitone: number, rootSemitone: number | null): void => {
    const entry = noteCells.get(semitone);
    if (!entry) return;
    const { cell } = entry;
    clearNoteTimers(semitone);
    cell.classList.remove("is-active", "is-root");
    void cell.getBoundingClientRect();
    cell.classList.add("is-active");
    if (rootSemitone !== null && semitone === wrap(rootSemitone)) {
      cell.classList.add("is-root");
    }
    startTrail(semitone, heldNoteSemitones.has(semitone));
  };

  const finishNoteVisual = (semitone: number): void => {
    const entry = noteCells.get(semitone);
    if (!entry) return;
    const { cell } = entry;
    clearNoteTimers(semitone);
    cell.classList.remove("is-active", "is-root");
    floatTrail(semitone);
  };

  const pulseNoteCells = (semitones: number[], rootSemitone: number | null, durationMs: number): void => {
    const normalized = Array.from(new Set(semitones.map((value) => wrap(value))));
    normalized.forEach((semitone) => {
      startNoteVisual(semitone, rootSemitone);
      if (heldNoteSemitones.has(semitone)) return;
      const timeoutId = window.setTimeout(() => {
        finishNoteVisual(semitone);
      }, Math.max(140, durationMs));
      notePulseTimeouts.set(semitone, timeoutId);
    });
  };

  NOTE_BAR_ORDER_SEMITONES.forEach((semitone, idx) => {
    const row = document.createElement("div");
    row.className = "cof-note-row";
    const rowDegree = document.createElement("span");
    rowDegree.className = "cof-note-row-degree";
    rowDegree.textContent = "";
    row.appendChild(rowDegree);

    const cell = document.createElement("div");
    cell.className = "cof-note-cell";
    cell.setAttribute("data-semitone", String(semitone));
    cell.setAttribute("role", "button");
    cell.setAttribute("tabindex", "0");
    const label = document.createElement("span");
    label.className = "cof-note-cell-label";
    label.textContent = NOTE_BAR_LABELS[idx] ?? "?";
    cell.appendChild(label);

    const notePayload = { label: NOTE_BAR_LABELS[idx] ?? "?", midi: midiFromSemitoneNearC4(semitone) };
    const activate = (): void => {
      pulseNoteCells([semitone], semitone, 520);
      options.onPulseRequest?.();
      options.onRandomnessRequest?.(0.75);
      options.onTap?.(notePayload);
    };

    let activePointerId: number | null = null;
    let suppressNextClick = false;
    const startPress = (event: PointerEvent): void => {
      if (activePointerId !== null) return;
      activePointerId = event.pointerId;
      // Audio belongs on pointerdown so touch input keeps the same attack feel
      // as desktop; the synthetic click is suppressed on release.
      activate();
      options.onPressStart?.(notePayload);
    };
    const endPress = (event: PointerEvent): void => {
      if (activePointerId === null || event.pointerId !== activePointerId) return;
      activePointerId = null;
      suppressNextClick = true;
      options.onPressEnd?.(notePayload);
    };

    cell.addEventListener("pointerdown", startPress);
    cell.addEventListener("pointerup", endPress);
    cell.addEventListener("pointercancel", endPress);
    cell.addEventListener("pointerleave", endPress);
    cell.addEventListener("click", (event) => {
      if (!suppressNextClick) {
        activate();
        return;
      }
      suppressNextClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    });
    cell.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate();
    });

    row.appendChild(cell);
    noteBar.appendChild(row);
    noteCells.set(semitone, { row, cell, degree: rowDegree });
  });

  return {
    element: noteBar,
    pulseNote(midi: number, durationMs = 400) {
      pulseNoteCells([midi], midi, durationMs);
    },
    pulseChord(midis: number[], durationMs = 640) {
      if (!midis.length) return;
      pulseNoteCells(midis, midis[0] ?? null, durationMs);
    },
    holdNote(midi: number) {
      const semitone = wrap(midi);
      heldNoteSemitones.add(semitone);
      pulseNoteCells([semitone], semitone, 420);
    },
    holdChord(midis: number[]) {
      if (!midis.length) return;
      const semitones = midis.map((midi) => wrap(midi));
      semitones.forEach((semitone) => heldNoteSemitones.add(semitone));
      pulseNoteCells(semitones, semitones[0] ?? null, 520);
    },
    releaseHeldNotes() {
      heldNoteSemitones.forEach((semitone) => {
        finishNoteVisual(semitone);
      });
      heldNoteSemitones.clear();
    },
    updateDegrees(primarySemitone: number | null) {
      noteCells.forEach(({ cell, degree }, semitone) => {
        if (primarySemitone === null) {
          cell.removeAttribute("data-degree");
          cell.removeAttribute("data-diatonic");
          degree.textContent = "";
          return;
        }
        const interval = wrap(semitone - primarySemitone);
        const token = options.degreeTokenForInterval(interval);
        if (!token) {
          cell.removeAttribute("data-degree");
          cell.setAttribute("data-diatonic", "false");
          degree.textContent = "";
          return;
        }
        cell.setAttribute("data-degree", options.degreeKeyFromToken(token));
        cell.setAttribute("data-diatonic", "true");
        degree.textContent = options.degreeLabelForMode(token);
      });
    },
    destroy() {
      notePulseTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      notePulseTimeouts.clear();
      noteTrailCleanupTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      noteTrailCleanupTimeouts.clear();
      noteTrailNodes.forEach((trail) => trail.remove());
      noteTrailNodes.clear();
      activeNoteTrails.clear();
      heldNoteSemitones.clear();
      noteBar.remove();
    },
  };
}
