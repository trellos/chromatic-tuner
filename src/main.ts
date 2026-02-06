const statusEl = document.getElementById("status");
const noteEl = document.getElementById("note");
const centsEl = document.getElementById("cents");
const strobeVisualizerEl = document.getElementById("strobe-visualizer");


const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const A4 = 440;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

async function createAudioContext(
  AudioCtx: typeof AudioContext
): Promise<AudioContext> {
  if (!isIOS) {
    return new AudioCtx({ latencyHint: "interactive" });
  }

  // iOS Safari can report a "bad" audio context on first init.
  // Warm up with a short silent buffer, then create the real context.
  try {
    const warmup = new AudioCtx({ latencyHint: "interactive" });
    await warmup.resume();
    const buffer = warmup.createBuffer(1, 1, warmup.sampleRate);
    const source = warmup.createBufferSource();
    source.buffer = buffer;
    source.connect(warmup.destination);
    source.start(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (warmup.state !== "closed") {
      await warmup.close();
    }
  } catch {
    // If warmup fails, fall back to a normal context.
  }

  return new AudioCtx({ latencyHint: "interactive" });
}

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

function computeRms(x: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i] ?? 0;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / x.length);
}

function createHannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

function yinDetectMain(
  x: Float32Array,
  sr: number,
  diff: Float32Array,
  cmnd: Float32Array,
  window: Float32Array
): { freqHz: number | null; confidence: number; tau: number; cmnd: number } {
  const n = x.length;
  const maxTau = diff.length;
  if (n < 4 || maxTau < 4) return { freqHz: null, confidence: 0, tau: 0, cmnd: 1 };

  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i] ?? 0;
  mean /= n;

  diff.fill(0);
  for (let tau = 1; tau < maxTau; tau++) {
    let sum = 0;
    const limit = n - tau;
    for (let i = 0; i < limit; i++) {
      const a = ((x[i] ?? 0) - mean) * (window[i] ?? 1);
      const b = ((x[i + tau] ?? 0) - mean) * (window[i + tau] ?? 1);
      const d = a - b;
      sum += d * d;
    }
    diff[tau] = sum;
  }

  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < maxTau; tau++) {
    runningSum += diff[tau] ?? 0;
    const v = diff[tau] ?? 0;
    cmnd[tau] = runningSum > 0 ? (v * tau) / runningSum : 1;
  }

  const threshold = 0.2;
  const tauMin = Math.max(2, Math.floor(sr / 1200));
  const tauMax = Math.min(maxTau - 1, Math.floor(sr / 70));
  let tauEstimate = -1;
  let bestVal = Number.POSITIVE_INFINITY;

  for (let tau = tauMin + 1; tau < tauMax; tau++) {
    const prev = cmnd[tau - 1] ?? 1;
    const cur = cmnd[tau] ?? 1;
    const next = cmnd[tau + 1] ?? 1;
    if (cur <= prev && cur <= next && cur < bestVal) {
      bestVal = cur;
      tauEstimate = tau;
    }
  }

  if (tauEstimate === -1) {
    let minVal = Number.POSITIVE_INFINITY;
    let minTau = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      const v = cmnd[tau] ?? 1;
      if (v < minVal) {
        minVal = v;
        minTau = tau;
      }
    }
    tauEstimate = minTau;
    bestVal = minVal;
    if (tauEstimate <= 0) return { freqHz: null, confidence: 0, tau: 0, cmnd: 1 };
  }

  if (bestVal > threshold) {
    return { freqHz: null, confidence: 0, tau: 0, cmnd: bestVal };
  }

  let bestTau = tauEstimate;
  let bestScore = cmnd[bestTau] ?? 1;
  const candidates = [
    tauEstimate / 2,
    tauEstimate / 3,
    tauEstimate * 2,
    tauEstimate * 3,
  ];

  for (const raw of candidates) {
    const candidate = Math.round(raw);
    if (candidate - 1 < tauMin || candidate + 1 > tauMax) continue;
    const ratio = Math.abs(Math.log2(candidate / tauEstimate));
    const penalty = 0.04 * ratio;
    const candVal = cmnd[candidate] ?? 1;
    const score = candVal + penalty;
    if (score < bestScore) {
      bestScore = score;
      bestTau = candidate;
    }
  }

  const t = Math.max(2, Math.min(bestTau, maxTau - 2));
  const x0 = cmnd[t - 1] ?? 1;
  const x1 = cmnd[t] ?? 1;
  const x2 = cmnd[t + 1] ?? 1;

  const denom = 2 * x1 - x2 - x0;
  const betterTau = denom !== 0 ? t + (x2 - x0) / (2 * denom) : t;
  const freqHz = betterTau > 0 ? sr / betterTau : null;
  const confidence = Math.max(0, Math.min(1, 1 - x1));

  if (freqHz === null || freqHz < 60 || freqHz > 1200) {
    return { freqHz: null, confidence: 0, tau: 0, cmnd: 1 };
  }

  return { freqHz, confidence, tau: betterTau, cmnd: x1 };
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

function setTestToneEnabled(enabled: boolean) {
  useTestTone = enabled;
  if (micGainNode && oscGainNode) {
    micGainNode.gain.value = enabled ? 0 : 1;
    oscGainNode.gain.value = enabled ? 1 : 0;
  }
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
let scriptNode: ScriptProcessorNode | null = null;
let scriptPitchHz: number | null = null;
let scriptPitchConf = 0;
let scriptWallSr: number | null = null;
let useTestTone = false;
let testOsc: OscillatorNode | null = null;
let micGainNode: GainNode | null = null;
let oscGainNode: GainNode | null = null;

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
  const ctx = await createAudioContext(AudioCtx);
  audioContext = ctx;
  await ctx.resume();
  if (!ctx) {
    throw new Error("AudioContext failed to initialize.");
  }

  setStatus("Loading worklet module…");
  if (!ctx.audioWorklet) {
    throw new Error(
      "AudioWorklet is not supported in this browser. Please use a newer iOS Safari.",
    );
  }

  await ctx.audioWorklet.addModule("./assets/worklet.js");

  setStatus("Creating audio graph…");
  const source = ctx.createMediaStreamSource(micStream);
  workletNode = new AudioWorkletNode(ctx, "tuner");

  const highPass = ctx.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = 70;
  highPass.Q.value = 0.707;

  const lowPass = ctx.createBiquadFilter();
  lowPass.type = "lowpass";
  lowPass.frequency.value = 1200;
  lowPass.Q.value = 0.707;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -30;
  compressor.knee.value = 18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.2;

  const gainNode = ctx.createGain();
  gainNode.gain.value = isIOS ? 2.2 : 3; // Compressor helps prevent clipping

  const micGain = ctx.createGain();
  micGain.gain.value = 1;
  micGainNode = micGain;

  const oscGain = ctx.createGain();
  oscGain.gain.value = 0;
  oscGainNode = oscGain;

  testOsc = ctx.createOscillator();
  testOsc.type = "sine";
  testOsc.frequency.value = 440;
  testOsc.start();

  source.connect(micGain);
  micGain.connect(highPass);
  testOsc.connect(oscGain);
  oscGain.connect(highPass);
  highPass.connect(lowPass);
  lowPass.connect(compressor);
  compressor.connect(gainNode);
  gainNode.connect(workletNode);
  workletNode.connect(ctx.destination);

  if (isIOS) {
    scriptNode = ctx.createScriptProcessor(2048, 1, 1);
    const windowSize = 4096;
    const ringSize = 16384;
    const ring = new Float32Array(ringSize);
    let writeIndex = 0;
    const analysisBuf = new Float32Array(windowSize);
    const diff = new Float32Array(windowSize / 2);
    const cmnd = new Float32Array(windowSize / 2);
    const window = createHannWindow(windowSize);
    const hopFrames = Math.floor(ctx.sampleRate / 20);
    let framesUntilAnalysis = hopFrames;
    let wallSampleCounter = 0;
    let wallLastTime = performance.now();

    const pushBlock = (input: Float32Array) => {
      const n = input.length;
      let i = 0;
      while (i < n) {
        const spaceToEnd = ringSize - writeIndex;
        const chunk = Math.min(spaceToEnd, n - i);
        ring.set(input.subarray(i, i + chunk), writeIndex);
        writeIndex += chunk;
        if (writeIndex >= ringSize) writeIndex -= ringSize;
        i += chunk;
      }
    };

    const copyLatestWindow = (dest: Float32Array) => {
      let idx = writeIndex - dest.length;
      while (idx < 0) idx += ringSize;
      for (let i = 0; i < dest.length; i++) {
        dest[i] = ring[idx] ?? 0;
        idx++;
        if (idx >= ringSize) idx = 0;
      }
    };

    scriptNode.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0);
      if (!input || input.length === 0) return;
      pushBlock(input);
      wallSampleCounter += input.length;
      const nowMs = performance.now();
      const dt = (nowMs - wallLastTime) / 1000;
      if (dt >= 0.2) {
        const measured = wallSampleCounter / dt;
        if (Number.isFinite(measured) && measured > 1000) {
          const alpha = 0.2;
          scriptWallSr =
            scriptWallSr == null
              ? measured
              : scriptWallSr + alpha * (measured - scriptWallSr);
        }
        wallSampleCounter = 0;
        wallLastTime = nowMs;
      }
      framesUntilAnalysis -= input.length;
      if (framesUntilAnalysis > 0) return;
      framesUntilAnalysis += hopFrames;
      copyLatestWindow(analysisBuf);
      const rms = computeRms(analysisBuf);
      if (rms < 0.002) {
        scriptPitchHz = null;
        scriptPitchConf = 0;
        return;
      }
      const srForAnalysis = scriptWallSr ?? ctx.sampleRate;
      const { freqHz, confidence } = yinDetectMain(
        analysisBuf,
        srForAnalysis,
        diff,
        cmnd,
        window
      );
      scriptPitchHz = freqHz;
      scriptPitchConf = confidence;
    };

    gainNode.connect(scriptNode);
    const spSink = ctx.createGain();
    spSink.gain.value = 0;
    scriptNode.connect(spSink);
    spSink.connect(ctx.destination);
  }

  workletNode.port.onmessage = (ev) => {
    const data = ev.data as any;

  if (data?.type === "worklet-ready") {
    setStatus(`Worklet ready. sr=${data.sampleRate}, ring=${data.bufferSize}`);
    return;
  }

  if (data?.type === "pitch") {
    let freqHz: number | null = data.freqHz ?? null;
    let confidence: number = Number(data.confidence ?? 0);
    const rms: number = Number(data.rms ?? 0);
    const tau: number | null = Number.isFinite(data.tau) ? Number(data.tau) : null;
    const cmnd: number | null = Number.isFinite(data.cmnd) ? Number(data.cmnd) : null;
    const effSr: number | null = Number.isFinite(data.effSr) ? Number(data.effSr) : null;
    const zcHz: number | null = Number.isFinite(data.zcHz) ? Number(data.zcHz) : null;

    if (isIOS && scriptPitchHz !== null) {
      freqHz = scriptPitchHz;
      confidence = scriptPitchConf;
    }

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
    const debugParts: string[] = [];
    if (tau !== null && cmnd !== null) {
      debugParts.push(`tau=${tau.toFixed(1)} cmnd=${cmnd.toFixed(3)}`);
    }
    if (effSr !== null) {
      debugParts.push(`effSR=${effSr.toFixed(0)}`);
    }
    if (zcHz !== null) {
      debugParts.push(`zc=${zcHz.toFixed(2)}`);
    }
    if (isIOS) {
      const sp = scriptPitchHz !== null ? scriptPitchHz.toFixed(2) : "null";
      debugParts.push(`sp=${sp}`);
      if (scriptWallSr !== null) {
        debugParts.push(`wallSR=${scriptWallSr.toFixed(0)}`);
      }
    }
    if (useTestTone) {
      debugParts.push("mode=osc");
    }
    const debug = debugParts.length ? ` ${debugParts.join(" ")}` : "";
    setStatus(`Hz=${freqHz.toFixed(2)} rms=${rms.toFixed(4)} conf=${confidence.toFixed(2)}${debug}`);
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
window.addEventListener("DOMContentLoaded", async () => {
  setReading(null, null);
  setStatus(isIOS ? "Tap to start audio..." : "Initializing audio...");
  document.body.classList.add("status-hidden");

  if (strobeVisualizerEl) {
    const toggleStatus = () => {
      document.body.classList.toggle("status-hidden");
    };
    let touchToggledAt = 0;
    let testToneTimer: number | null = null;
    strobeVisualizerEl.addEventListener("click", () => {
      // iOS fires click after touchend; suppress double-toggle.
      if (Date.now() - touchToggledAt < 500) return;
      toggleStatus();
    });
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
      { passive: true }
    );
    if (isIOS) {
      strobeVisualizerEl.addEventListener(
        "touchstart",
        () => {
          if (testToneTimer !== null) return;
          testToneTimer = window.setTimeout(() => {
            testToneTimer = null;
            setTestToneEnabled(!useTestTone);
            document.body.classList.remove("status-hidden");
            setStatus(useTestTone ? "Test tone ON (440 Hz)" : "Test tone OFF");
          }, 600);
        },
        { passive: true }
      );
    }
  }

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

