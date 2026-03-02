import {
  buildModeHintsForTonic,
  normalizePitchClassSet,
  rankKeyFinderCandidates,
  chromaticLabelForKey,
  type KeyFinderCandidate,
  type NotationPreference,
} from "./key-finder-logic.js";
import type { ModeDefinition } from "./types.js";

const NOTE_BUTTON_LABELS = [
  "C",
  "C#/Db",
  "D",
  "D#/Eb",
  "E",
  "F",
  "F#/Gb",
  "G",
  "G#/Ab",
  "A",
  "A#/Bb",
  "B",
] as const;
const DISPLAY_LIMIT = 6;

function buildScaleTokens(candidate: KeyFinderCandidate, selected: Set<number>): DocumentFragment {
  const fragment = document.createDocumentFragment();
  candidate.scale.forEach((pitchClass, index) => {
    const token = document.createElement("span");
    token.className = "key-finder-token";
    if (selected.has(pitchClass)) token.classList.add("is-selected");
    token.textContent = candidate.scaleLabels[index] ?? chromaticLabelForKey(pitchClass, candidate);
    fragment.appendChild(token);
    if (index < candidate.scale.length - 1) fragment.appendChild(document.createTextNode(" "));
  });

  if (candidate.outliers.length > 0) {
    fragment.appendChild(document.createTextNode(" "));
    const outlierText = document.createElement("span");
    outlierText.className = "key-finder-outliers-inline";
    outlierText.textContent = `(non-diatonic: ${candidate.outliers
      .map((pitchClass) => chromaticLabelForKey(pitchClass, candidate))
      .join(" ")})`;
    fragment.appendChild(outlierText);
  }

  return fragment;
}

function randomnessFromConfidence(confidence: number): number {
  // Visual mapping requested by product:
  // - 100% match => 0 randomness (clean pattern)
  // - 66% match => 0.3 randomness
  // - below 66% ramps up toward 1.0
  // Randomness is applied to the seigaiha texture/noise only (not card rotation).
  if (confidence >= 100) return 0;
  if (confidence >= 66) return ((100 - confidence) / 34) * 0.3;
  return Math.min(1, 0.3 + ((66 - confidence) / 66) * 0.7);
}

function applyCardPattern(card: HTMLElement, candidate: KeyFinderCandidate): void {
  const randomness = randomnessFromConfidence(candidate.confidence);
  const outlierSeverity = Math.min(1, candidate.outliers.length / 3);

  // Confidence keeps the original smooth gradient, while explicit non-diatonic
  // count guarantees a visible visual jump from 0 to 3 outliers.
  const visualIntensity = Math.max(randomness, outlierSeverity);

  card.style.setProperty("--kf-randomness", randomness.toFixed(3));
  card.style.setProperty("--kf-intensity", visualIntensity.toFixed(3));
  card.style.setProperty("--kf-noise-offset", `${Math.round(visualIntensity * 38)}px`);
  card.style.setProperty("--kf-desat", `${Math.round(visualIntensity * 100)}%`);
  card.style.setProperty("--kf-lift", `${Math.round(visualIntensity * 8)}%`);
}

export function createKeyFinderMode(): ModeDefinition {
  const screen = document.querySelector<HTMLElement>('.mode-screen[data-mode="key-finder"]');
  const notesContainer = screen?.querySelector<HTMLElement>("[data-key-finder-notes]") ?? null;
  const resultsContainer = screen?.querySelector<HTMLElement>("[data-key-finder-results]") ?? null;
  const emptyHint = screen?.querySelector<HTMLElement>("[data-key-finder-empty]") ?? null;
  const modeHints = screen?.querySelector<HTMLElement>("[data-key-finder-mode-hints]") ?? null;
  const clearBtn = screen?.querySelector<HTMLButtonElement>("[data-key-finder-clear]") ?? null;

  let selected = new Set<number>();
  const notation: NotationPreference = "sharp";
  let uiAbort: AbortController | null = null;

  const togglePitchClass = (pitchClass: number): void => {
    if (selected.has(pitchClass)) selected.delete(pitchClass);
    else selected.add(pitchClass);
    render();
  };

  const selectCandidate = (candidate: KeyFinderCandidate): void => {
    if (!modeHints) return;
    const relatedModes = buildModeHintsForTonic(candidate.tonic, notation);
    modeHints.textContent = `${candidate.label}: ${relatedModes.join(" · ")}`;
    modeHints.hidden = false;
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
      button.textContent = NOTE_BUTTON_LABELS[pitchClass] ?? "C";
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
    });

    if (resultsContainer) {
      resultsContainer.innerHTML = "";
      candidates.forEach((candidate, index) => {
        const row = document.createElement("article");
        row.className = "key-finder-result";
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        applyCardPattern(row, candidate);

        const header = document.createElement("header");
        header.className = "key-finder-result-header";
        const title = document.createElement("h4");
        title.textContent = candidate.label;
        header.append(title);

        const notesLine = document.createElement("p");
        notesLine.className = "key-finder-result-notes";
        notesLine.appendChild(buildScaleTokens(candidate, selected));

        const activate = () => selectCandidate(candidate);
        row.addEventListener("click", activate, { signal: uiAbort!.signal });
        row.addEventListener(
          "keydown",
          (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            activate();
          },
          { signal: uiAbort!.signal }
        );

        row.append(header, notesLine);
        resultsContainer.appendChild(row);
        if (index === 0 && !modeHints?.textContent) selectCandidate(candidate);
      });
    }

    if (emptyHint) emptyHint.hidden = normalized.length !== 0;
    if (modeHints && normalized.length === 0) {
      modeHints.hidden = true;
      modeHints.textContent = "";
    }
  };

  return {
    id: "key-finder",
    title: "Key Finder",
    preserveState: true,
    canFullscreen: false,
    onEnter: () => {
      if (!screen) return;
      // This mode rebuilds its lightweight DOM on each entry so listener wiring
      // stays local to a single AbortController lifecycle and cannot leak.
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
