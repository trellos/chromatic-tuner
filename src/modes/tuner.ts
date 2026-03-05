import type { ModeDefinition } from "./types.js";
import { createCircleGuitarPlayer } from "../audio/circle-guitar-player.js";
import {
  createCircleOfFifthsUi,
  getCircleChordMidis,
  type CircleOfFifthsUi,
} from "../ui/circle-of-fifths.js";
import { pitchService } from "../app/pitch-detection.js";
import { seigaihaBridge } from "../app/seigaiha-bridge.js";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const A4 = 440;
const SHOW_STATUS = new URLSearchParams(window.location.search).has("debug");

// DOM elements — populated at onEnter, cleared at onExit.
let statusEl: HTMLElement | null = null;
let noteEl: HTMLElement | null = null;
let centsEl: HTMLElement | null = null;
let liveRegionEl: HTMLElement | null = null;
let strobeVisualizerEl: HTMLElement | null = null;
let tunaFieldEl: HTMLElement | null = null;
let tunerVisualButtons: NodeListOf<HTMLButtonElement> | null = null;
let tunerCircleHostEl: HTMLElement | null = null;

let tunerVisualMode: "strobe" | "circle" = "strobe";
let tunerCircleUi: CircleOfFifthsUi | null = null;
let tunerCircleRandomnessTimer: number | null = null;
const tunerCircleAudio = createCircleGuitarPlayer();

type PitchSample = { midi: number; cents: number; hz: number; conf: number; rms: number };

const history: PitchSample[] = [];
const HISTORY_N = 5;

let lockedMidi: number | null = null;
let candidateMidi: number | null = null;
let candidateCount = 0;

let centsEma: number | null = null;
let overlayRing: SVGPathElement | null = null;
let strobeDots: SVGPathElement | null = null;
const TUNA_TILE_COUNT = 42;
const TUNA_FIELD_SIZE = 280;
let tunaTiles: HTMLSpanElement[] = [];
let tunaFieldReady = false;
let strobeInitialized = false;

let currentRotation = 0;
let currentDotsRotation = 0;
let lastUpdateTime = Date.now();
let animationFrameId: number | null = null;
let tunerUiAbort: AbortController | null = null;

function freqToMidi(freqHz: number): number {
  return Math.round(12 * Math.log2(freqHz / A4) + 69);
}

function midiToFreq(midi: number): number {
  return A4 * Math.pow(2, (midi - 69) / 12);
}

function centsOffFromMidi(freqHz: number, midi: number): number {
  return 1200 * Math.log2(freqHz / midiToFreq(midi));
}

function midiToNoteName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

function median(values: number[]): number {
  const a = [...values].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? (a[mid] ?? 0) : ((a[mid - 1] ?? 0) + (a[mid] ?? 0)) / 2;
}

function wrapCents(c: number): number {
  if (c >= 50) return c - 100;
  if (c < -50) return c + 100;
  return c;
}

// Initialize SVG strobe visualizer — Peterson-style two concentric dashed arcs.
// Guard ensures it only runs once across multiple onEnter calls.
function initializeStrobeVisualizer(): void {
  if (!strobeVisualizerEl || strobeInitialized) return;
  strobeInitialized = true;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 280 280");
  svg.setAttribute("width", "280");
  svg.setAttribute("height", "280");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const createArcPath = (radius: number): SVGPathElement => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const startX = 140 - radius;
    const startY = 140;
    const endX = 140 + radius;
    const endY = 140;
    path.setAttribute("d", `M ${startX} ${startY} A ${radius} ${radius} 0 0 1 ${endX} ${endY}`);
    path.setAttribute("fill", "none");
    return path;
  };

  const outerArc = createArcPath(130);
  outerArc.style.stroke = "#808080";
  outerArc.style.strokeWidth = "12";
  outerArc.style.strokeDasharray = "48 48";
  outerArc.style.strokeDashoffset = "0";
  strobeDots = outerArc;
  svg.appendChild(outerArc);

  const innerArc = createArcPath(116);
  innerArc.style.stroke = "#808080";
  innerArc.style.strokeWidth = "12";
  innerArc.style.strokeDasharray = "24 24";
  innerArc.style.strokeDashoffset = "0";
  overlayRing = innerArc;
  svg.appendChild(innerArc);

  strobeVisualizerEl.appendChild(svg);
}

function createTunaField(): void {
  if (!tunaFieldEl || tunaFieldReady) return;
  const fragment = document.createDocumentFragment();
  tunaTiles = [];
  for (let i = 0; i < TUNA_TILE_COUNT; i++) {
    const tile = document.createElement("span");
    tile.className = "tuna-tile";
    fragment.appendChild(tile);
    tunaTiles.push(tile);
  }
  tunaFieldEl.appendChild(fragment);
  tunaFieldReady = true;
}

function updateTunaField(centsValue: number | null, isDetecting: boolean): void {
  if (!tunaFieldEl) return;
  if (!tunaFieldReady) createTunaField();
  if (tunaTiles.length === 0) return;

  const boundedCents = centsValue == null ? 0 : Math.max(-50, Math.min(50, centsValue));
  const detune = Math.abs(boundedCents) / 50;
  const direction = boundedCents === 0 ? 0 : Math.sign(boundedCents);
  const sharpness = Math.max(0, boundedCents) / 50;
  const flatness = Math.max(0, -boundedCents) / 50;

  tunaFieldEl.style.setProperty("--detune", detune.toFixed(3));
  tunaFieldEl.style.setProperty("--sharpness", sharpness.toFixed(3));
  tunaFieldEl.style.setProperty("--flatness", flatness.toFixed(3));
  tunaFieldEl.style.setProperty("--state-rotation", `${(direction * detune * 8).toFixed(2)}deg`);

  if (!isDetecting || centsValue === null) {
    tunaFieldEl.classList.remove("is-detecting", "is-sharp", "is-flat");
    return;
  }

  tunaFieldEl.classList.add("is-detecting");
  tunaFieldEl.classList.toggle("is-sharp", direction > 0);
  tunaFieldEl.classList.toggle("is-flat", direction < 0);

  const center = TUNA_FIELD_SIZE / 2;
  const turns = 4.1;
  const spiralStart = -Math.PI / 2;
  const sharpNudge = 16 * sharpness;
  const flatNudge = 16 * flatness;

  tunaTiles.forEach((tile, index) => {
    const t = (index + 1) / TUNA_TILE_COUNT;
    const angle = spiralStart + t * Math.PI * 2 * turns;
    const radius = t * (TUNA_FIELD_SIZE * 0.33);
    const spiralX = center + Math.cos(angle) * radius;
    const spiralY = center + Math.sin(angle) * radius;
    const col = index % 7;
    const row = Math.floor(index / 7);
    const gridBaseX = 36 + col * 34;
    const gridBaseY = 34 + row * 36;
    const sharpWarp =
      ((row % 2 === 0 ? 1 : -1) * sharpNudge) +
      Math.sin(col * 1.4 + row * 0.6) * (6 + sharpNudge * 0.25);
    const flatWarp =
      ((col % 2 === 0 ? -1 : 1) * flatNudge) +
      Math.cos(col * 0.55 + row * 1.15) * (6 + flatNudge * 0.25);
    const driftX = sharpness > 0 ? sharpWarp : -flatWarp;
    const driftY =
      sharpness > 0
        ? Math.cos(row * 0.95 + col * 0.35) * (8 + sharpNudge * 0.2)
        : Math.sin(col * 1.12 + row * 0.42) * (8 + flatNudge * 0.2);
    const gridX = gridBaseX + driftX;
    const gridY = gridBaseY + driftY;
    const x = spiralX + (gridX - spiralX) * detune;
    const y = spiralY + (gridY - spiralY) * detune;
    const localRotation = direction * detune * 14 + Math.sin(index * 1.618) * 6 * detune;
    tile.style.left = `${x.toFixed(2)}px`;
    tile.style.top = `${y.toFixed(2)}px`;
    tile.style.transform = `translate(-50%, -50%) rotate(${localRotation.toFixed(2)}deg)`;
    tile.style.opacity = `${(0.2 + (isDetecting ? 0.58 : 0) + detune * 0.18).toFixed(3)}`;
  });
}

function setStatus(msg: string): void {
  if (statusEl) statusEl.textContent = msg;
}

function setReading(note: string | null, cents: string | null): void {
  if (noteEl) noteEl.textContent = note ?? "";
  if (centsEl) centsEl.textContent = cents ?? "";
  if (liveRegionEl) liveRegionEl.textContent = note && cents ? `${note}, ${cents}` : "";
}

function updateStrobeVisualizerRotation(centsValue: number | null, isDetecting: boolean): void {
  if (!strobeVisualizerEl || !strobeDots || !overlayRing) return;
  const now = Date.now();
  const deltaTime = (now - lastUpdateTime) / 1000;
  lastUpdateTime = now;
  if (centsValue !== null && isDetecting) {
    const offsetPerSecond = centsValue * 3;
    currentRotation += offsetPerSecond * deltaTime;
    currentDotsRotation -= offsetPerSecond * deltaTime;
    currentRotation = currentRotation % 400;
    currentDotsRotation = currentDotsRotation % 400;
  }
  (strobeDots as SVGPathElement).style.strokeDashoffset = String(currentRotation);
  (overlayRing as SVGPathElement).style.strokeDashoffset = String(currentDotsRotation);
}

function updateStrobeVisualizer(centsValue: number | null, isDetecting: boolean): void {
  if (!strobeVisualizerEl) return;
  strobeVisualizerEl.classList.toggle("detecting", isDetecting);
  strobeVisualizerEl.classList.toggle("idle", !isDetecting);
  const svg = strobeVisualizerEl.querySelector("svg");
  if (svg) {
    const strokeColor = isDetecting ? "#8b5cf6" : "#808080";
    svg.querySelectorAll("circle, path").forEach((el: any) => {
      el.style.stroke = strokeColor;
    });
  }
  updateTunaField(centsValue, isDetecting);
  updateStrobeVisualizerRotation(centsValue, isDetecting);
}

function setTunerVisualMode(mode: "strobe" | "circle"): void {
  tunerVisualMode = mode;
  strobeVisualizerEl?.classList.toggle("is-hidden", mode !== "strobe");
  tunerCircleHostEl?.classList.toggle("is-hidden", mode !== "circle");
  tunerVisualButtons?.forEach((button) => {
    const isActive = button.dataset.tunerVisual === mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function clearTunerCircleRandomness(): void {
  if (tunerCircleRandomnessTimer !== null) {
    window.clearTimeout(tunerCircleRandomnessTimer);
    tunerCircleRandomnessTimer = null;
  }
  seigaihaBridge.setModeRandomness(0);
}

function pulseTunerCircleRandomness(durationMs: number): void {
  if (tunerCircleRandomnessTimer !== null) {
    window.clearTimeout(tunerCircleRandomnessTimer);
  }
  seigaihaBridge.pulse();
  seigaihaBridge.setModeRandomness(0.7);
  tunerCircleRandomnessTimer = window.setTimeout(() => {
    tunerCircleRandomnessTimer = null;
    seigaihaBridge.setModeRandomness(0);
  }, durationMs);
}

function ensureTunerCircleUi(): void {
  if (!tunerCircleHostEl || tunerCircleUi) return;
  tunerCircleUi = createCircleOfFifthsUi(tunerCircleHostEl, {
    onOuterTap: (note) => {
      pulseTunerCircleRandomness(440);
      void tunerCircleAudio.playMidi(note.midi, 420);
    },
    onSecondaryTap: (chord) => {
      pulseTunerCircleRandomness(680);
      void tunerCircleAudio.playChord(getCircleChordMidis(chord), 660);
    },
  });
}

function stopAnimationLoop(): void {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

// Resets all note-lock and smoothing state (called on silence or mode exit).
function resetPitchState(): void {
  history.length = 0;
  lockedMidi = null;
  candidateMidi = null;
  candidateCount = 0;
  centsEma = null;
}

// Enters tuner mode: wires UI interactions and starts pitch detection via service.
async function enterTunerMode(): Promise<void> {
  // Resolve DOM elements now (Phase 5 — no module-level queries).
  statusEl = document.getElementById("status");
  noteEl = document.getElementById("note");
  centsEl = document.getElementById("cents");
  liveRegionEl = document.getElementById("tuner-live");
  strobeVisualizerEl = document.getElementById("strobe-visualizer");
  tunaFieldEl = document.getElementById("tuna-field");
  tunerVisualButtons = document.querySelectorAll<HTMLButtonElement>("[data-tuner-visual]");
  tunerCircleHostEl = document.querySelector<HTMLElement>("[data-tuner-circle-host]");

  tunerUiAbort?.abort();
  tunerUiAbort = new AbortController();
  const { signal } = tunerUiAbort;

  setReading(null, null);
  initializeStrobeVisualizer();
  createTunaField();
  setStatus("Idle");
  ensureTunerCircleUi();
  setTunerVisualMode(tunerVisualMode);

  tunerVisualButtons?.forEach((button) => {
    button.addEventListener(
      "click",
      () => {
        const mode = button.dataset.tunerVisual === "circle" ? "circle" : "strobe";
        setTunerVisualMode(mode);
      },
      { signal }
    );
  });

  if (SHOW_STATUS) {
    setStatus("Initializing audio...");
    document.body.classList.remove("status-hidden");
  } else {
    document.body.classList.add("status-hidden");
  }

  if (strobeVisualizerEl) {
    let testToneTimer: number | null = null;
    if (SHOW_STATUS) {
      const toggleStatus = () => {
        document.body.classList.toggle("status-hidden");
      };
      let touchToggledAt = 0;
      strobeVisualizerEl.addEventListener(
        "click",
        () => {
          if (Date.now() - touchToggledAt < 500) return;
          toggleStatus();
        },
        { signal }
      );
      strobeVisualizerEl.addEventListener(
        "touchend",
        () => {
          touchToggledAt = Date.now();
          toggleStatus();
          if (testToneTimer !== null) {
            clearTimeout(testToneTimer);
            testToneTimer = null;
          }
        },
        { passive: true, signal }
      );
    }
    // iOS: long-press strobe to toggle test tone.
    if (pitchService.isActive || /iPad|iPhone|iPod/.test(navigator.userAgent)) {
      strobeVisualizerEl.addEventListener(
        "touchstart",
        () => {
          if (testToneTimer !== null) return;
          testToneTimer = window.setTimeout(() => {
            testToneTimer = null;
            const useTestTone = !document.body.classList.contains("test-tone-active");
            document.body.classList.toggle("test-tone-active", useTestTone);
            pitchService.setTestTone(useTestTone);
            document.body.classList.remove("status-hidden");
            setStatus(useTestTone ? "Test tone ON (440 Hz)" : "Test tone OFF");
          }, 600);
        },
        { passive: true, signal }
      );
    }
  }

  // Start the strobe animation loop independently of pitch data.
  const animate = () => {
    const isDetecting = lockedMidi !== null && centsEma !== null;
    updateStrobeVisualizerRotation(centsEma, isDetecting);
    animationFrameId = requestAnimationFrame(animate);
  };
  animationFrameId = requestAnimationFrame(animate);

  // Delay pitch start slightly so the mode transition completes first.
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 500);
    signal.addEventListener("abort", () => { window.clearTimeout(timer); resolve(); }, { once: true });
  });
  if (signal.aborted) return;

  await pitchService.start({
    onStatusChange: (msg) => {
      if (SHOW_STATUS) setStatus(msg);
    },
    onSilence: (rms, confidence) => {
      resetPitchState();
      seigaihaBridge.setDetuneMagnitude(null);
      tunerCircleUi?.setPrimaryByMidi(null);
      tunerCircleUi?.setTuningCents(null);
      clearTunerCircleRandomness();
      updateStrobeVisualizer(null, false);
      setReading(null, null);
      if (SHOW_STATUS) setStatus(`No pitch (rms=${rms.toFixed(4)}, conf=${confidence.toFixed(2)})`);
    },
    onPitch: (result) => {
      const { freqHz, confidence, rms, tau, cmnd, effSr, zcHz, isIOS: resIOS, scriptPitchHz, scriptWallSr } = result;

      const midi = freqToMidi(freqHz);
      const centsRaw = wrapCents(centsOffFromMidi(freqHz, midi));

      history.push({ midi, cents: centsRaw, hz: freqHz, conf: confidence, rms });
      if (history.length > HISTORY_N) history.shift();

      const medMidi = Math.round(median(history.map((h) => h.midi)));
      if (lockedMidi == null) {
        lockedMidi = medMidi;
      } else if (medMidi !== lockedMidi) {
        if (candidateMidi !== medMidi) {
          candidateMidi = medMidi;
          candidateCount = 1;
        } else {
          candidateCount++;
        }
        const framesToSwitch = 3;
        if (candidateCount >= framesToSwitch) {
          lockedMidi = candidateMidi;
          candidateMidi = null;
          candidateCount = 0;
          centsEma = null;
        }
      } else {
        candidateMidi = null;
        candidateCount = 0;
      }

      if (lockedMidi == null) return;
      const centsForLocked = wrapCents(centsOffFromMidi(freqHz, lockedMidi));
      const alpha = 0.2;
      centsEma = centsEma == null ? centsForLocked : centsEma + alpha * (centsForLocked - centsEma);

      const note = midiToNoteName(lockedMidi);
      seigaihaBridge.setDetuneMagnitude(Math.abs(centsEma));
      tunerCircleUi?.setPrimaryByMidi(lockedMidi);
      tunerCircleUi?.setTuningCents(centsEma);
      updateStrobeVisualizer(centsEma, true);
      setReading(note, `${centsEma >= 0 ? "+" : ""}${centsEma.toFixed(1)} cents`);

      if (SHOW_STATUS) {
        const debugParts: string[] = [];
        if (tau !== null && cmnd !== null) debugParts.push(`tau=${tau.toFixed(1)} cmnd=${cmnd.toFixed(3)}`);
        if (effSr !== null) debugParts.push(`effSR=${effSr.toFixed(0)}`);
        if (zcHz !== null) debugParts.push(`zc=${zcHz.toFixed(2)}`);
        if (resIOS) {
          const sp = scriptPitchHz !== null ? scriptPitchHz.toFixed(2) : "null";
          debugParts.push(`sp=${sp}`);
          if (scriptWallSr !== null) debugParts.push(`wallSR=${scriptWallSr.toFixed(0)}`);
        }
        const debug = debugParts.length ? ` ${debugParts.join(" ")}` : "";
        setStatus(`Hz=${freqHz.toFixed(2)} rms=${rms.toFixed(4)} conf=${confidence.toFixed(2)}${debug}`);
      }
    },
  });
}

// Leaves tuner mode and tears down runtime/audio resources.
function exitTunerMode(): void {
  tunerUiAbort?.abort();
  tunerUiAbort = null;
  stopAnimationLoop();
  pitchService.stop();
  setReading(null, null);
  updateStrobeVisualizer(null, false);
  tunerCircleUi?.setPrimaryByMidi(null);
  tunerCircleUi?.setTuningCents(null);
  clearTunerCircleRandomness();
  void tunerCircleAudio.destroy();
  seigaihaBridge.setDetuneMagnitude(null);
  resetPitchState();
  // Clear element references so the module has no live DOM handles.
  statusEl = null;
  noteEl = null;
  centsEl = null;
  liveRegionEl = null;
  strobeVisualizerEl = null;
  tunaFieldEl = null;
  tunerVisualButtons = null;
  tunerCircleHostEl = null;
}

// Mode factory for the Chromatic Tuner screen and lifecycle hooks.
export function createTunerMode(): ModeDefinition {
  return {
    id: "tuner",
    title: "Chromatic Tuner",
    preserveState: false,
    canFullscreen: false,
    onEnter: enterTunerMode,
    onExit: exitTunerMode,
  };
}
