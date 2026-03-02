import { createCircleOfFifthsUi } from "../ui/circle-of-fifths.js";
import {
  formatPitchClassList,
  normalizePitchClassSet,
  rankKeyFinderCandidates,
  type NotationPreference,
} from "./key-finder-logic.js";
import type { ModeDefinition } from "./types.js";

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const OPEN_STRING_PITCH_CLASSES = [4, 11, 7, 2, 9, 4];
const FRET_COUNT = 12;
const DISPLAY_LIMIT = 6;

function noteLabel(pc: number, notation: NotationPreference): string {
  const labels = notation === "flat" ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  return labels[pc] ?? "C";
}

export function createKeyFinderMode(): ModeDefinition {
  const screen = document.querySelector<HTMLElement>('.mode-screen[data-mode="key-finder"]');
  const notesContainer = screen?.querySelector<HTMLElement>("[data-key-finder-notes]") ?? null;
  const fretboardContainer = screen?.querySelector<HTMLElement>("[data-key-finder-fretboard]") ?? null;
  const selectedContainer = screen?.querySelector<HTMLElement>("[data-key-finder-selected]") ?? null;
  const resultsContainer = screen?.querySelector<HTMLElement>("[data-key-finder-results]") ?? null;
  const emptyHint = screen?.querySelector<HTMLElement>("[data-key-finder-empty]") ?? null;
  const statusEl = screen?.querySelector<HTMLElement>("[data-key-finder-status]") ?? null;
  const circleHost = screen?.querySelector<HTMLElement>("[data-key-finder-circle]") ?? null;
  const inputTabs = screen?.querySelectorAll<HTMLButtonElement>("[data-key-finder-input]") ?? [];
  const notationTabs = screen?.querySelectorAll<HTMLButtonElement>("[data-key-finder-notation]") ?? [];
  const clearBtn = screen?.querySelector<HTMLButtonElement>("[data-key-finder-clear]") ?? null;

  let selected = new Set<number>();
  let notation: NotationPreference = "sharp";
  let inputMode: "notes" | "fretboard" = "notes";
  let uiAbort: AbortController | null = null;
  let circleUi: ReturnType<typeof createCircleOfFifthsUi> | null = null;

  const togglePitchClass = (pitchClass: number): void => {
    if (selected.has(pitchClass)) {
      selected.delete(pitchClass);
    } else {
      selected.add(pitchClass);
    }
    render();
  };

  const setInputMode = (mode: "notes" | "fretboard"): void => {
    inputMode = mode;
    inputTabs.forEach((tab) => {
      const active = tab.dataset.keyFinderInput === mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
    notesContainer?.toggleAttribute("hidden", mode !== "notes");
    fretboardContainer?.toggleAttribute("hidden", mode !== "fretboard");
  };

  const setNotation = (next: NotationPreference): void => {
    notation = next;
    notationTabs.forEach((tab) => {
      const active = tab.dataset.keyFinderNotation === next;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
    render();
  };

  const buildNotesInput = (): void => {
    if (!notesContainer) return;
    notesContainer.innerHTML = "";
    for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "key-finder-note-btn";
      btn.dataset.pitchClass = String(pitchClass);
      btn.textContent = noteLabel(pitchClass, notation);
      btn.addEventListener("click", () => togglePitchClass(pitchClass), { signal: uiAbort?.signal });
      notesContainer.appendChild(btn);
    }
  };

  const buildFretboardInput = (): void => {
    if (!fretboardContainer) return;
    fretboardContainer.innerHTML = "";
    for (let stringIndex = 0; stringIndex < OPEN_STRING_PITCH_CLASSES.length; stringIndex += 1) {
      const row = document.createElement("div");
      row.className = "key-finder-fret-row";
      const stringLabel = document.createElement("span");
      stringLabel.className = "key-finder-fret-string";
      stringLabel.textContent = ["E", "B", "G", "D", "A", "E"][stringIndex] ?? "E";
      row.appendChild(stringLabel);

      for (let fret = 0; fret <= FRET_COUNT; fret += 1) {
        const pitchClass = (OPEN_STRING_PITCH_CLASSES[stringIndex] + fret) % 12;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "key-finder-fret-btn";
        button.dataset.pitchClass = String(pitchClass);
        button.dataset.fret = String(fret);
        button.setAttribute("aria-label", `String ${stringLabel.textContent} fret ${fret} (${noteLabel(pitchClass, notation)})`);
        button.addEventListener("click", () => togglePitchClass(pitchClass), { signal: uiAbort?.signal });
        row.appendChild(button);
      }
      fretboardContainer.appendChild(row);
    }
  };

  const render = (): void => {
    const normalized = normalizePitchClassSet([...selected]);
    const ranked = rankKeyFinderCandidates(normalized, { notation });
    const activeCandidates = ranked.candidates.slice(0, DISPLAY_LIMIT);

    screen?.querySelectorAll<HTMLElement>("[data-pitch-class]").forEach((el) => {
      const pitchClass = Number.parseInt(el.dataset.pitchClass ?? "-1", 10);
      const active = selected.has(pitchClass);
      el.classList.toggle("is-active", active);
      if (el instanceof HTMLButtonElement) {
        el.setAttribute("aria-pressed", String(active));
      }
      if (el.classList.contains("key-finder-note-btn")) {
        el.textContent = noteLabel(pitchClass, notation);
      }
      if (el.classList.contains("key-finder-fret-btn")) {
        const fret = Number.parseInt(el.dataset.fret ?? "0", 10);
        const row = el.closest(".key-finder-fret-row");
        const stringLabel = row?.querySelector<HTMLElement>(".key-finder-fret-string")?.textContent ?? "E";
        el.setAttribute("aria-label", `String ${stringLabel} fret ${fret} (${noteLabel(pitchClass, notation)})`);
      }
    });

    if (selectedContainer) {
      selectedContainer.innerHTML = "";
      if (normalized.length === 0) {
        selectedContainer.textContent = "No notes selected";
      } else {
        normalized.forEach((pc) => {
          const chip = document.createElement("span");
          chip.className = "key-finder-chip";
          chip.textContent = noteLabel(pc, notation);
          selectedContainer.appendChild(chip);
        });
      }
    }

    if (resultsContainer) {
      resultsContainer.innerHTML = "";
      activeCandidates.forEach((candidate) => {
        const row = document.createElement("article");
        row.className = "key-finder-result";

        const header = document.createElement("header");
        header.className = "key-finder-result-header";
        const title = document.createElement("h4");
        title.textContent = candidate.label;
        const score = document.createElement("span");
        score.className = "key-finder-result-score";
        score.textContent = `${candidate.confidence}%`;
        header.append(title, score);

        const bar = document.createElement("div");
        bar.className = "key-finder-result-bar";
        const fill = document.createElement("span");
        fill.style.width = `${candidate.confidence}%`;
        bar.appendChild(fill);

        const summary = document.createElement("p");
        summary.className = "key-finder-result-summary";
        summary.textContent = `${candidate.confidenceLabel} · ${candidate.matched.length}/${normalized.length} diatonic`;

        const notes = document.createElement("p");
        notes.className = "key-finder-result-notes";
        notes.textContent = candidate.emphasizedScaleText.replaceAll("*", "");

        const outliers = document.createElement("p");
        outliers.className = "key-finder-result-outliers";
        const outlierText = candidate.outliers.length
          ? formatPitchClassList(candidate.outliers, notation)
          : "none";
        outliers.textContent = `Outliers: ${outlierText}`;

        const preview = document.createElement("button");
        preview.type = "button";
        preview.className = "key-finder-preview-btn";
        preview.textContent = "▶ Preview tonic chord";
        preview.addEventListener(
          "click",
          () => {
            circleUi?.setPrimaryByLabel(noteLabel(candidate.tonic, notation));
            circleUi?.pulseChord([60 + candidate.tonic, 64 + candidate.tonic, 67 + candidate.tonic], 600);
          },
          { signal: uiAbort?.signal }
        );

        row.addEventListener(
          "click",
          () => {
            circleUi?.setPrimaryByLabel(noteLabel(candidate.tonic, notation));
            circleUi?.setMinorMode(candidate.mode === "aeolian");
          },
          { signal: uiAbort?.signal }
        );

        row.append(header, bar, summary, notes, outliers, preview);
        resultsContainer.appendChild(row);
      });
    }

    if (statusEl) {
      statusEl.textContent = ranked.lowData
        ? "Low data: add more notes for stronger confidence."
        : ranked.isAmbiguous
          ? "Ambiguous: multiple close fits."
          : "";
    }

    if (emptyHint) {
      emptyHint.hidden = normalized.length !== 0;
    }

    if (normalized.length === 0) {
      circleUi?.setPrimaryByLabel(null);
    } else if (activeCandidates[0]) {
      circleUi?.setPrimaryByLabel(noteLabel(activeCandidates[0].tonic, notation));
      circleUi?.setMinorMode(activeCandidates[0].mode === "aeolian");
    }
  };

  return {
    id: "key-finder",
    title: "Key Finder",
    icon: "KF",
    preserveState: true,
    canFullscreen: false,
    onEnter: () => {
      if (!screen) return;
      uiAbort?.abort();
      uiAbort = new AbortController();

      if (circleHost) {
        circleUi?.destroy();
        circleUi = createCircleOfFifthsUi(circleHost);
        circleUi.showInnerIndicator("KEY FINDER");
      }

      buildNotesInput();
      buildFretboardInput();
      clearBtn?.addEventListener(
        "click",
        () => {
          selected.clear();
          render();
        },
        { signal: uiAbort.signal }
      );

      inputTabs.forEach((tab) => {
        tab.addEventListener(
          "click",
          () => setInputMode(tab.dataset.keyFinderInput === "fretboard" ? "fretboard" : "notes"),
          { signal: uiAbort?.signal }
        );
      });

      notationTabs.forEach((tab) => {
        tab.addEventListener(
          "click",
          () => setNotation(tab.dataset.keyFinderNotation === "flat" ? "flat" : "sharp"),
          { signal: uiAbort?.signal }
        );
      });

      setInputMode(inputMode);
      setNotation(notation);
      render();
    },
    onExit: () => {
      uiAbort?.abort();
      uiAbort = null;
      circleUi?.destroy();
      circleUi = null;
    },
  };
}
