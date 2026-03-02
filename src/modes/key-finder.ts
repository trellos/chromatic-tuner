import {
  normalizePitchClassSet,
  rankKeyFinderCandidates,
  type KeyFinderCandidate,
  type NotationPreference,
} from "./key-finder-logic.js";
import type { ModeDefinition } from "./types.js";

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const DISPLAY_LIMIT = 6;

function noteLabel(pitchClass: number, notation: NotationPreference): string {
  const labels = notation === "flat" ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  return labels[pitchClass] ?? "C";
}

function buildScaleTokens(
  candidate: KeyFinderCandidate,
  selected: Set<number>,
  notation: NotationPreference
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  candidate.scale.forEach((pitchClass, index) => {
    const token = document.createElement("span");
    token.className = "key-finder-token";
    if (selected.has(pitchClass)) token.classList.add("is-selected");
    token.textContent = noteLabel(pitchClass, notation);
    fragment.appendChild(token);
    if (index < candidate.scale.length - 1) {
      fragment.appendChild(document.createTextNode(" "));
    }
  });
  if (candidate.outliers.length > 0) {
    fragment.appendChild(document.createTextNode(" "));
    const outlierText = document.createElement("span");
    outlierText.className = "key-finder-outliers-inline";
    outlierText.textContent = `(non-diatonic: ${candidate.outliers
      .map((pitchClass) => noteLabel(pitchClass, notation))
      .join(" ")})`;
    fragment.appendChild(outlierText);
  }
  return fragment;
}

export function createKeyFinderMode(): ModeDefinition {
  const screen = document.querySelector<HTMLElement>('.mode-screen[data-mode="key-finder"]');
  const notesContainer = screen?.querySelector<HTMLElement>("[data-key-finder-notes]") ?? null;
  const selectedContainer = screen?.querySelector<HTMLElement>("[data-key-finder-selected]") ?? null;
  const resultsContainer = screen?.querySelector<HTMLElement>("[data-key-finder-results]") ?? null;
  const emptyHint = screen?.querySelector<HTMLElement>("[data-key-finder-empty]") ?? null;
  const statusEl = screen?.querySelector<HTMLElement>("[data-key-finder-status]") ?? null;
  const clearBtn = screen?.querySelector<HTMLButtonElement>("[data-key-finder-clear]") ?? null;

  let selected = new Set<number>();
  const notation: NotationPreference = "sharp";
  let uiAbort: AbortController | null = null;

  const togglePitchClass = (pitchClass: number): void => {
    if (selected.has(pitchClass)) selected.delete(pitchClass);
    else selected.add(pitchClass);
    render();
  };

  const buildNotesInput = (signal: AbortSignal): void => {
    if (!notesContainer) return;
    notesContainer.innerHTML = "";
    for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "key-finder-note-btn";
      button.dataset.pitchClass = String(pitchClass);
      button.setAttribute("aria-pressed", "false");
      button.textContent = noteLabel(pitchClass, notation);
      button.addEventListener("click", () => togglePitchClass(pitchClass), { signal });
      notesContainer.appendChild(button);
    }
  };

  const render = (): void => {
    const normalized = normalizePitchClassSet([...selected]);
    const ranked = rankKeyFinderCandidates(normalized, { notation });
    const candidates = ranked.candidates.slice(0, DISPLAY_LIMIT);

    notesContainer?.querySelectorAll<HTMLButtonElement>("[data-pitch-class]").forEach((button) => {
      const pitchClass = Number.parseInt(button.dataset.pitchClass ?? "-1", 10);
      const active = selected.has(pitchClass);
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.textContent = noteLabel(pitchClass, notation);
    });

    if (selectedContainer) {
      selectedContainer.innerHTML = "";
      if (normalized.length === 0) {
        selectedContainer.textContent = "No notes selected";
      } else {
        normalized.forEach((pitchClass) => {
          const chip = document.createElement("span");
          chip.className = "key-finder-chip";
          chip.textContent = noteLabel(pitchClass, notation);
          selectedContainer.appendChild(chip);
        });
      }
    }

    if (resultsContainer) {
      resultsContainer.innerHTML = "";
      candidates.forEach((candidate) => {
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

        const notesLine = document.createElement("p");
        notesLine.className = "key-finder-result-notes";
        notesLine.appendChild(buildScaleTokens(candidate, selected, notation));

        row.append(header, bar, notesLine);
        resultsContainer.appendChild(row);
      });
    }

    if (statusEl) {
      if (normalized.length === 0) {
        statusEl.textContent = "";
      } else if (ranked.lowData) {
        statusEl.textContent = "Low data: add more notes for stronger confidence.";
      } else if (ranked.isAmbiguous) {
        statusEl.textContent = "Ambiguous: multiple close fits.";
      } else {
        statusEl.textContent = "";
      }
    }

    if (emptyHint) emptyHint.hidden = normalized.length !== 0;
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
      const signal = uiAbort.signal;
      buildNotesInput(signal);
      clearBtn?.addEventListener(
        "click",
        () => {
          selected.clear();
          render();
        },
        { signal }
      );
      render();
    },
    onExit: () => {
      uiAbort?.abort();
      uiAbort = null;
    },
  };
}
