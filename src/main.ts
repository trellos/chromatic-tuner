const statusEl = document.getElementById("status");
const noteEl = document.getElementById("note");
const centsEl = document.getElementById("cents");
const strobeVisualizerEl = document.getElementById("strobe-visualizer");


const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const A4 = 440;

// Initialize SVG strobe visualizer - Peterson-style two concentric dashed arcs
function initializeStrobeVisualizer(): void {
  if (!strobeVisualizerEl) return;
  
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 280 280");
  svg.setAttribute("width", "280");
  svg.setAttribute("height", "280");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  
  const createArcPath = (radius: number): SVGPathElement => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    // Top semicircle from left to right.
    const startX = 140 - radius;
    const startY = 140;
    const endX = 140 + radius;
    const endY = 140;
    path.setAttribute("d", `M ${startX} ${startY} A ${radius} ${radius} 0 0 1 ${endX} ${endY}`);
    path.setAttribute("fill", "none");
    return path;
  };

  // Outer dashed arc (larger radius)
  const outerArc = createArcPath(130);
  outerArc.style.stroke = "#808080";
  outerArc.style.strokeWidth = "12";
  outerArc.style.strokeDasharray = "8 24";
  outerArc.style.strokeDashoffset = "0";

  strobeDots = outerArc as any; // Reuse to track the animated element
  svg.appendChild(outerArc);

  // Inner dashed arc (smaller radius)
  const innerArc = createArcPath(116);
  innerArc.style.stroke = "#808080";
  innerArc.style.strokeWidth = "12";
  innerArc.style.strokeDasharray = "12 12";
  innerArc.style.strokeDashoffset = "0";

  overlayRing = innerArc as any;
  svg.appendChild(innerArc);

  strobeVisualizerEl.appendChild(svg);
}

type PitchSample = { midi: number; cents: number; hz: number; conf: number; rms: number };

const history: PitchSample[] = [];
const HISTORY_N = 5;

let lockedMidi: number | null = null;
let candidateMidi: number | null = null;
let candidateCount = 0;

let centsEma: number | null = null;
let overlayRing: SVGPathElement | null = null;
let strobeDots: SVGPathElement | null = null;

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
  const octave = Math.floor(midi / 12) - 1; // MIDI octave convention
  return `${name}${octave}`;
}

let lastMidi: number | null = null;
let lastFreq: number | null = null;

function smoothFreq(newFreq: number): number {
  // simple 1-pole low-pass on frequency
  if (lastFreq == null) return (lastFreq = newFreq);
  const alpha = 0.25; // higher = more responsive, lower = smoother
  lastFreq = lastFreq + alpha * (newFreq - lastFreq);
  return lastFreq;
}

function median(values: number[]): number {
  const a = [...values].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? (a[mid] ?? 0) : ((a[mid - 1] ?? 0) + (a[mid] ?? 0)) / 2;
}

function wrapCents(c: number): number {
  // Keep cents in [-50, +50) relative to the chosen nearest note
  // (your cents calc already does this, but this is a safety clamp)
  if (c >= 50) return c - 100;
  if (c < -50) return c + 100;
  return c;
}

function setStatus(msg: string) {
  if (statusEl) statusEl.textContent = msg;
}

function setReading(note: string | null, cents: string | null) {
  if (noteEl) noteEl.textContent = note ?? "";
  if (centsEl) centsEl.textContent = cents ?? "";
}

let currentRotation = 0;
let currentDotsRotation = 0;
let lastUpdateTime = Date.now();

function updateStrobeVisualizerRotation(centsValue: number | null, isDetecting: boolean): void {
  if (!strobeVisualizerEl) return;

  const svg = strobeVisualizerEl.querySelector("svg");
  if (!svg) return;

  const outerCircle = strobeDots as any;
  const innerCircle = overlayRing as any;

  if (!outerCircle || !innerCircle) return;

  // Calculate dash offset animation based on cents value
  // centsEma ranges from -50 to +50
  // Dash offset determines which part of the dashed pattern is visible
  const now = Date.now();
  const deltaTime = (now - lastUpdateTime) / 1000; // convert to seconds
  lastUpdateTime = now;

  if (centsValue !== null && isDetecting) {
    // Map cents to dash offset speed
    // Positive cents (sharp) move dashes one direction, negative (flat) move opposite
    const offsetPerSecond = centsValue * 3;
    currentRotation += offsetPerSecond * deltaTime;
    currentDotsRotation -= offsetPerSecond * deltaTime; // Opposite direction
    
    // Normalize offsets to avoid huge numbers
    currentRotation = currentRotation % 400;
    currentDotsRotation = currentDotsRotation % 400;
  }

  // Apply dash offset to both circles (opposite directions)
  outerCircle.style.strokeDashoffset = String(currentRotation);
  innerCircle.style.strokeDashoffset = String(currentDotsRotation);
}

function updateStrobeVisualizer(centsValue: number | null, isDetecting: boolean): void {
  if (!strobeVisualizerEl) return;

  // Update color based on detection state
  const colorClass = isDetecting ? "detecting" : "idle";
  strobeVisualizerEl.className = `strobe-tuner ${colorClass}`;

  // Update circle stroke colors based on detection state
  const svg = strobeVisualizerEl.querySelector("svg");
  if (svg) {
    const circles = svg.querySelectorAll("circle, path");
    const strokeColor = isDetecting ? "#8b5cf6" : "#808080";
    circles.forEach((circle: any) => {
      circle.style.stroke = strokeColor;
    });
  }

  updateStrobeVisualizerRotation(centsValue, isDetecting);
}

setStatus("Idle");
setReading(null, null);
initializeStrobeVisualizer();

let audioContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let workletNode: AudioWorkletNode | null = null;
let animationFrameId: number | null = null;

async function startAudio() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Microphone access not available. On iOS Safari this requires HTTPS (secure context).");
  }

  setStatus("Requesting microphone permission…");

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  });

  setStatus("Creating AudioContext…");
  const AudioCtx =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error("AudioContext is not available in this browser.");
  }
  audioContext = new AudioCtx({ latencyHint: "interactive" });
  await audioContext.resume();

  setStatus("Loading worklet module…");
  await audioContext.audioWorklet.addModule("./assets/worklet.js");

  setStatus("Creating audio graph…");
  const source = audioContext.createMediaStreamSource(micStream);
  workletNode = new AudioWorkletNode(audioContext, "tuner");
  
  const gainNode = audioContext.createGain();
  gainNode.gain.value = 3; // Modest amplification

  source.connect(gainNode);
  gainNode.connect(workletNode);
  workletNode.connect(audioContext.destination);

  workletNode.port.onmessage = (ev) => {
    const data = ev.data as any;

  if (data?.type === "worklet-ready") {
    setStatus(`Worklet ready. sr=${data.sampleRate}, ring=${data.bufferSize}`);
    return;
  }

  if (data?.type === "pitch") {
    const freqHz: number | null = data.freqHz ?? null;
    const confidence: number = Number(data.confidence ?? 0);
    const rms: number = Number(data.rms ?? 0);

    if (freqHz == null) {
        // Reset state when no pitch
        history.length = 0;
        lockedMidi = null;
        candidateMidi = null;
        candidateCount = 0;
        centsEma = null;

        updateStrobeVisualizer(null, false);
        setReading(null, null);
        setStatus(`No pitch (rms=${rms.toFixed(4)}, conf=${confidence.toFixed(2)})`);        return;
    }

    // Convert to midi/note first
    const midi = freqToMidi(freqHz);
    const centsRaw = wrapCents(centsOffFromMidi(freqHz, midi));

    history.push({ midi, cents: centsRaw, hz: freqHz, conf: confidence, rms });
    if (history.length > HISTORY_N) history.shift();

    // Median filter to kill spikes
    const medMidi = Math.round(median(history.map(h => h.midi)));
    const medCents = median(history.map(h => h.cents));

    // Note lock: require the new note to persist for a few frames
    if (lockedMidi == null) {
        lockedMidi = medMidi;
    } else if (medMidi !== lockedMidi) {
        if (candidateMidi !== medMidi) {
            candidateMidi = medMidi;
            candidateCount = 1;
        } else {
            candidateCount++;
        }

        // Require persistence. At ~20 Hz, 3 frames ≈ 150 ms.
        const framesToSwitch = 3;
        if (candidateCount >= framesToSwitch) {
            lockedMidi = candidateMidi;
            candidateMidi = null;
            candidateCount = 0;
            centsEma = null; // reset smoothing when note changes
        }   
    } else {
        // same note, clear candidate
        candidateMidi = null;
        candidateCount = 0;
    }

    // Smooth cents with EMA (on the locked note)
    if( lockedMidi == null ) return; // should not happen
    const centsForLocked = wrapCents(centsOffFromMidi(freqHz, lockedMidi));
    const alpha = 0.2; // responsiveness vs smoothness
    centsEma = centsEma == null ? centsForLocked : (centsEma + alpha * (centsForLocked - centsEma));

    const note = midiToNoteName(lockedMidi);
    updateStrobeVisualizer(centsEma, true);
    setReading(note, `${centsEma >= 0 ? "+" : ""}${centsEma.toFixed(1)} cents`);
    setStatus(`Hz=${freqHz.toFixed(2)} rms=${rms.toFixed(4)} conf=${confidence.toFixed(2)}`);
    return;
  }
  };

  // Start animation loop for smooth strobe rotation
  const animate = () => {
    const isDetecting = lockedMidi !== null && centsEma !== null;
    updateStrobeVisualizerRotation(centsEma, isDetecting);
    animationFrameId = requestAnimationFrame(animate);
  };
  animationFrameId = requestAnimationFrame(animate);
}

// Auto-start audio on page load
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

window.addEventListener("DOMContentLoaded", async () => {
  setReading(null, null);
  setStatus(isIOS ? "Tap to start audio..." : "Initializing audio...");

  const startWithHandling = async () => {
    try {
      await startAudio();
    } catch (err) {
      console.error(err);
      
      let errorMsg = "Error starting audio";
      if (err instanceof Error) {
        if (err.name === "NotAllowedError" || err.message.includes("permission")) {
          errorMsg = "Microphone permission denied. Please allow microphone access to use the tuner.";
        } else if (err.name === "NotFoundError" || err.message.includes("no device")) {
          errorMsg = "No microphone found. Please connect a microphone and try again.";
        } else {
          errorMsg = `Error: ${err.message}`;
        }
      }
      
      setStatus(errorMsg);
      updateStrobeVisualizer(null, false);
    }
  };

  if (isIOS) {
    const onFirstInteraction = () => {
      document.removeEventListener("click", onFirstInteraction);
      document.removeEventListener("touchend", onFirstInteraction);
      startWithHandling();
    };
    document.addEventListener("click", onFirstInteraction, { once: true });
    document.addEventListener("touchend", onFirstInteraction, { once: true, passive: true });
  } else {
    await startWithHandling();
  }
});

