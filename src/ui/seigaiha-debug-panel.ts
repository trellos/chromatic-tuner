import type { ModeId } from "../modes/types.js";
import type { MetronomeRandomnessParams } from "../modes/metronome.js";
import {
  getSeigaihaDetuneMapping,
  getSeigaihaPerformanceStats,
  getSeigaihaRandomness,
  getSeigaihaRendererBackend,
  getSeigaihaTunerSmoothingTimeConstantMs,
  isSeigaihaDebugOverrideEnabled,
  setSeigaihaDebugOverrideEnabled,
  setSeigaihaDetuneMapping,
  setSeigaihaTunerSmoothingTimeConstantMs,
  setSeigaihaRandomness,
} from "./seigaihaBackground.js";
import { clamp } from "../utils.js";

type SeigaihaDebugPanelOptions = {
  getActiveModeId: () => ModeId;
  getMetronomeParams: () => MetronomeRandomnessParams;
  setMetronomeParams: (params: MetronomeRandomnessParams) => void;
  getDrumTarget: () => number;
  setDrumTarget: (target: number) => void;
};

// Builds the seigaiha debug overlay (shown when ?debug is in the URL).
// Returns a sync function that should be called whenever activeModeId changes,
// or null if debug mode is not enabled.
export function bindSeigaihaDebugControl(
  options: SeigaihaDebugPanelOptions
): (() => void) | null {
  const shouldShowDebugControl = new URLSearchParams(window.location.search).has("debug");
  if (!shouldShowDebugControl) return null;

  const panel = document.createElement("div");
  panel.className = "seigaiha-debug-control";

  const title = document.createElement("p");
  title.className = "seigaiha-debug-title";
  title.textContent = "Seigaiha randomness";

  const tunerSection = document.createElement("section");
  tunerSection.className = "seigaiha-debug-section";
  tunerSection.setAttribute("data-debug-section", "tuner");

  const telemetrySection = document.createElement("section");
  telemetrySection.className = "seigaiha-debug-section";
  telemetrySection.setAttribute("data-debug-section", "telemetry");

  const metronomeSection = document.createElement("section");
  metronomeSection.className = "seigaiha-debug-section";
  metronomeSection.setAttribute("data-debug-section", "metronome");

  const drumSection = document.createElement("section");
  drumSection.className = "seigaiha-debug-section";
  drumSection.setAttribute("data-debug-section", "drum-machine");

  const overrideRow = document.createElement("label");
  overrideRow.className = "seigaiha-debug-switch";
  overrideRow.setAttribute("for", "seigaiha-override-toggle");

  const overrideToggle = document.createElement("input");
  overrideToggle.type = "checkbox";
  overrideToggle.id = "seigaiha-override-toggle";
  overrideToggle.checked = isSeigaihaDebugOverrideEnabled();
  overrideToggle.setAttribute("aria-label", "Enable seigaiha slider override");
  overrideRow.appendChild(overrideToggle);
  overrideRow.append("OVR");

  const value = document.createElement("span");
  value.className = "seigaiha-debug-value";
  value.textContent = getSeigaihaRandomness().toFixed(2);

  const fps = document.createElement("span");
  fps.className = "seigaiha-debug-fps";
  fps.textContent = "FPS --";

  const perf = document.createElement("pre");
  perf.className = "seigaiha-debug-metrics";
  perf.textContent =
    "displayFPS --\nseigaihaFPS --\nuploads/s --\np95 --ms\nmax --ms\nswaps/s --\ncache --/--";

  const smoothingRow = document.createElement("label");
  smoothingRow.className = "seigaiha-debug-switch";
  smoothingRow.setAttribute("for", "seigaiha-smoothing-ms");
  smoothingRow.append("SM");

  const smoothingInput = document.createElement("input");
  smoothingInput.type = "number";
  smoothingInput.id = "seigaiha-smoothing-ms";
  smoothingInput.min = "16";
  smoothingInput.max = "1000";
  smoothingInput.step = "1";
  smoothingInput.value = String(Math.round(getSeigaihaTunerSmoothingTimeConstantMs()));
  smoothingInput.setAttribute("aria-label", "Seigaiha tuner smoothing ms");
  smoothingInput.addEventListener("change", () => {
    const parsed = Number.parseFloat(smoothingInput.value);
    if (!Number.isFinite(parsed)) return;
    setSeigaihaTunerSmoothingTimeConstantMs(parsed);
    smoothingInput.value = String(Math.round(getSeigaihaTunerSmoothingTimeConstantMs()));
  });
  smoothingRow.appendChild(smoothingInput);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = "seigaiha-randomness-slider";
  slider.min = "0";
  slider.max = "1";
  slider.step = "0.01";
  slider.value = String(getSeigaihaRandomness());
  slider.disabled = !overrideToggle.checked;
  slider.setAttribute("aria-label", "Seigaiha randomness");

  const tableLabel = document.createElement("p");
  tableLabel.className = "seigaiha-debug-subtitle";
  tableLabel.textContent = "Detune mapping (abs cents)";

  const table = document.createElement("table");
  table.className = "seigaiha-debug-table";
  const tableHead = document.createElement("thead");
  tableHead.innerHTML = "<tr><th>Abs cents</th><th>Randomness</th></tr>";
  const tableBody = document.createElement("tbody");
  table.appendChild(tableHead);
  table.appendChild(tableBody);

  const metronomeLabel = document.createElement("p");
  metronomeLabel.className = "seigaiha-debug-subtitle";
  metronomeLabel.textContent = "Metronome params";

  const metronomeTable = document.createElement("table");
  metronomeTable.className = "seigaiha-debug-table seigaiha-debug-table--compact";
  const metronomeBody = document.createElement("tbody");
  metronomeTable.appendChild(metronomeBody);

  const drumLabel = document.createElement("p");
  drumLabel.className = "seigaiha-debug-subtitle";
  drumLabel.textContent = "Drum params";

  const drumTargetRow = document.createElement("label");
  drumTargetRow.className = "seigaiha-debug-switch";
  drumTargetRow.setAttribute("for", "seigaiha-drum-target");
  drumTargetRow.append("TG");

  const drumTargetInput = document.createElement("input");
  drumTargetInput.type = "number";
  drumTargetInput.id = "seigaiha-drum-target";
  drumTargetInput.min = "0";
  drumTargetInput.max = "1";
  drumTargetInput.step = "0.01";
  drumTargetInput.value = options.getDrumTarget().toFixed(2);
  drumTargetInput.setAttribute("aria-label", "Drum randomness target");
  drumTargetInput.addEventListener("change", () => {
    const parsed = Number.parseFloat(drumTargetInput.value);
    if (!Number.isFinite(parsed)) return;
    const clamped = clamp(parsed, 0, 1);
    options.setDrumTarget(clamped);
    drumTargetInput.value = clamped.toFixed(2);
  });
  drumTargetRow.appendChild(drumTargetInput);

  type MetronomeDebugField = {
    key: keyof MetronomeRandomnessParams;
    label: string;
    min?: number;
    max?: number;
    step?: number;
  };

  const metronomeFields: MetronomeDebugField[] = [
    { key: "naMax", label: "NA", min: 0, max: 1, step: 0.01 },
    { key: "inc44", label: "I44", min: 0, max: 1, step: 0.01 },
    { key: "inc34", label: "I34", min: 0, max: 1, step: 0.01 },
    { key: "inc68", label: "I68", min: 0, max: 1, step: 0.01 },
    { key: "upCurve", label: "UP", min: 1, max: 6, step: 0.05 },
    { key: "downCurve", label: "DN", min: 1, max: 8, step: 0.05 },
  ];

  function setMetronomeParam(key: keyof MetronomeRandomnessParams, value: number): void {
    const current = options.getMetronomeParams()[key];
    let next = Number.isFinite(value) ? value : current;
    const field = metronomeFields.find((item) => item.key === key);
    if (field?.min !== undefined) next = Math.max(field.min, next);
    if (field?.max !== undefined) next = Math.min(field.max, next);
    options.setMetronomeParams({ ...options.getMetronomeParams(), [key]: next });
  }

  function renderMetronomeTable(): void {
    metronomeBody.replaceChildren();
    metronomeFields.forEach((field) => {
      const row = document.createElement("tr");

      const keyCell = document.createElement("td");
      keyCell.textContent = field.label;

      const valueCell = document.createElement("td");
      const input = document.createElement("input");
      input.type = "number";
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      if (field.step !== undefined) input.step = String(field.step);
      input.value = String(options.getMetronomeParams()[field.key]);
      input.setAttribute("aria-label", `Metronome randomness ${field.label}`);
      input.addEventListener("change", () => {
        const parsed = Number.parseFloat(input.value);
        if (!Number.isFinite(parsed)) return;
        setMetronomeParam(field.key, parsed);
        renderMetronomeTable();
      });
      valueCell.appendChild(input);

      row.appendChild(keyCell);
      row.appendChild(valueCell);
      metronomeBody.appendChild(row);
    });
  }

  function renderMappingTable(): void {
    const mapping = getSeigaihaDetuneMapping();
    tableBody.replaceChildren();
    mapping.forEach((point, index) => {
      const row = document.createElement("tr");

      const centsCell = document.createElement("td");
      const centsInput = document.createElement("input");
      centsInput.type = "number";
      centsInput.step = "0.1";
      centsInput.min = "0";
      centsInput.value = point.cents.toString();
      centsInput.setAttribute("aria-label", `Mapping abs cents row ${index + 1}`);
      centsInput.addEventListener("change", () => {
        const next = Number.parseFloat(centsInput.value);
        if (!Number.isFinite(next)) return;
        const current = getSeigaihaDetuneMapping();
        const updated = current[index];
        if (!updated) return;
        updated.cents = Math.max(0, next);
        setSeigaihaDetuneMapping(current);
        renderMappingTable();
      });
      centsCell.appendChild(centsInput);

      const randomnessCell = document.createElement("td");
      const randomnessInput = document.createElement("input");
      randomnessInput.type = "number";
      randomnessInput.step = "0.01";
      randomnessInput.min = "0";
      randomnessInput.max = "1";
      randomnessInput.value = point.randomness.toString();
      randomnessInput.setAttribute("aria-label", `Mapping randomness row ${index + 1}`);
      randomnessInput.addEventListener("change", () => {
        const next = Number.parseFloat(randomnessInput.value);
        if (!Number.isFinite(next)) return;
        const current = getSeigaihaDetuneMapping();
        const updated = current[index];
        if (!updated) return;
        updated.randomness = Math.max(0, Math.min(1, next));
        setSeigaihaDetuneMapping(current);
        renderMappingTable();
      });
      randomnessCell.appendChild(randomnessInput);

      row.appendChild(centsCell);
      row.appendChild(randomnessCell);
      tableBody.appendChild(row);
    });
  }

  overrideToggle.addEventListener("change", () => {
    const enabled = overrideToggle.checked;
    setSeigaihaDebugOverrideEnabled(enabled);
    slider.disabled = !enabled;
    if (enabled) {
      const nextValue = Number.parseFloat(slider.value);
      if (Number.isFinite(nextValue)) {
        setSeigaihaRandomness(nextValue);
      }
    }
    value.textContent = getSeigaihaRandomness().toFixed(2);
  });

  slider.addEventListener("input", () => {
    if (!overrideToggle.checked) return;
    const nextValue = Number.parseFloat(slider.value);
    if (!Number.isFinite(nextValue)) return;
    setSeigaihaRandomness(nextValue);
    value.textContent = getSeigaihaRandomness().toFixed(2);
  });

  const telemetryLabel = document.createElement("p");
  telemetryLabel.className = "seigaiha-debug-subtitle";
  telemetryLabel.textContent = "Telemetry";
  telemetrySection.appendChild(telemetryLabel);
  telemetrySection.appendChild(fps);
  telemetrySection.appendChild(perf);

  tunerSection.appendChild(overrideRow);
  tunerSection.appendChild(slider);
  tunerSection.appendChild(value);
  tunerSection.appendChild(smoothingRow);
  tunerSection.appendChild(tableLabel);
  tunerSection.appendChild(table);

  metronomeSection.appendChild(metronomeLabel);
  metronomeSection.appendChild(metronomeTable);

  drumSection.appendChild(drumLabel);
  drumSection.appendChild(drumTargetRow);

  panel.appendChild(title);
  panel.appendChild(telemetrySection);
  panel.appendChild(tunerSection);
  panel.appendChild(metronomeSection);
  panel.appendChild(drumSection);
  document.body.appendChild(panel);

  renderMappingTable();
  renderMetronomeTable();

  let rafFrames = 0;
  let rafWindowStartAt = performance.now();
  const tickFps = (): void => {
    rafFrames += 1;
    requestAnimationFrame(tickFps);
  };
  requestAnimationFrame(tickFps);
  window.setInterval(() => {
    value.textContent = getSeigaihaRandomness().toFixed(2);
    const now = performance.now();
    const dt = Math.max(1, now - rafWindowStartAt);
    const avgFps = (rafFrames * 1000) / dt;
    rafFrames = 0;
    rafWindowStartAt = now;
    const stats = getSeigaihaPerformanceStats();
    fps.textContent = `FPS ${avgFps.toFixed(1)}`;
    perf.textContent = [
      `backend ${getSeigaihaRendererBackend()}`,
      `displayFPS ${avgFps.toFixed(1)}`,
      `seigaihaFPS ${stats.renderDrawsPerSec.toFixed(1)}`,
      `uploads/s ${stats.textureUploadsPerSec.toFixed(1)}`,
      `p95 ${stats.p95FrameTimeMs.toFixed(1)}ms`,
      `max ${stats.maxFrameTimeMs.toFixed(1)}ms`,
      `swaps/s ${stats.renderSwapsPerSec.toFixed(1)}`,
      `cache ${stats.cacheHits}/${stats.cacheMisses} (${(stats.cacheHitRate * 100).toFixed(0)}%)`,
    ].join("\n");
  }, 120);

  // Returns a function that syncs section visibility to the active mode.
  return () => {
    const activeMode = options.getActiveModeId();
    tunerSection.style.display = activeMode === "tuner" ? "" : "none";
    metronomeSection.style.display = activeMode === "metronome" ? "" : "none";
    drumSection.style.display = activeMode === "drum-machine" ? "" : "none";
  };
}
