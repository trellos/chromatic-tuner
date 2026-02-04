const startButton = document.getElementById("start") as HTMLButtonElement | null;
const statusEl = document.getElementById("status");
const noteEl = document.getElementById("note");
const centsEl = document.getElementById("cents");

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const A4 = 440;

type PitchSample = { midi: number; cents: number; hz: number; conf: number; rms: number };

const history: PitchSample[] = [];
const HISTORY_N = 5;

let lockedMidi: number | null = null;
let candidateMidi: number | null = null;
let candidateCount = 0;

let centsEma: number | null = null;

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
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
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

setStatus("Idle");
setReading(null, null);

let audioContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let workletNode: AudioWorkletNode | null = null;

async function startAudio() {
  setStatus("Requesting microphone permission…");

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  setStatus("Creating AudioContext…");
  audioContext = new AudioContext({ latencyHint: "interactive" });
  await audioContext.resume();

  setStatus("Loading worklet module…");
  await audioContext.audioWorklet.addModule("/assets/worklet.js");

  setStatus("Creating audio graph…");
  const source = audioContext.createMediaStreamSource(micStream);

  workletNode = new AudioWorkletNode(audioContext, "tuner");

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

        setReading(null, null);
        setStatus(`No pitch (rms=${rms.toFixed(4)}, conf=${confidence.toFixed(2)})`);
        return;
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
    setReading(note, `${centsEma >= 0 ? "+" : ""}${centsEma.toFixed(1)} cents`);
    setStatus(`Hz=${freqHz.toFixed(2)} rms=${rms.toFixed(4)} conf=${confidence.toFixed(2)}`);
    
  }

  setStatus(`Worklet message: ${JSON.stringify(data)}`);
};


  source.connect(workletNode);
}

startButton?.addEventListener("click", async () => {
  startButton.disabled = true;
  setReading(null, null);

  try {
    await startAudio();
  } catch (err) {
    console.error(err);
    setStatus(
      err instanceof Error ? `Error: ${err.message}` : "Error starting audio"
    );
    startButton.disabled = false;
  }
});
