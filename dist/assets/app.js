var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/main.ts
var require_main = __commonJS({
  "src/main.ts"() {
    var startButton = document.getElementById("start");
    var statusEl = document.getElementById("status");
    var noteEl = document.getElementById("note");
    var centsEl = document.getElementById("cents");
    var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    var A4 = 440;
    var history = [];
    var HISTORY_N = 5;
    var lockedMidi = null;
    var candidateMidi = null;
    var candidateCount = 0;
    var centsEma = null;
    function freqToMidi(freqHz) {
      return Math.round(12 * Math.log2(freqHz / A4) + 69);
    }
    function midiToFreq(midi) {
      return A4 * Math.pow(2, (midi - 69) / 12);
    }
    function centsOffFromMidi(freqHz, midi) {
      return 1200 * Math.log2(freqHz / midiToFreq(midi));
    }
    function midiToNoteName(midi) {
      const name = NOTE_NAMES[(midi % 12 + 12) % 12];
      const octave = Math.floor(midi / 12) - 1;
      return `${name}${octave}`;
    }
    function median(values) {
      const a = [...values].sort((x, y) => x - y);
      const mid = Math.floor(a.length / 2);
      return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
    }
    function wrapCents(c) {
      if (c >= 50) return c - 100;
      if (c < -50) return c + 100;
      return c;
    }
    function setStatus(msg) {
      if (statusEl) statusEl.textContent = msg;
    }
    function setReading(note, cents) {
      if (noteEl) noteEl.textContent = note ?? "";
      if (centsEl) centsEl.textContent = cents ?? "";
    }
    setStatus("Idle");
    setReading(null, null);
    var audioContext = null;
    var micStream = null;
    var workletNode = null;
    async function startAudio() {
      setStatus("Requesting microphone permission\u2026");
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      setStatus("Creating AudioContext\u2026");
      audioContext = new AudioContext({ latencyHint: "interactive" });
      await audioContext.resume();
      setStatus("Loading worklet module\u2026");
      await audioContext.audioWorklet.addModule("/assets/worklet.js");
      setStatus("Creating audio graph\u2026");
      const source = audioContext.createMediaStreamSource(micStream);
      workletNode = new AudioWorkletNode(audioContext, "tuner");
      workletNode.port.onmessage = (ev) => {
        const data = ev.data;
        if (data?.type === "worklet-ready") {
          setStatus(`Worklet ready. sr=${data.sampleRate}, ring=${data.bufferSize}`);
          return;
        }
        if (data?.type === "pitch") {
          const freqHz = data.freqHz ?? null;
          const confidence = Number(data.confidence ?? 0);
          const rms = Number(data.rms ?? 0);
          if (freqHz == null) {
            history.length = 0;
            lockedMidi = null;
            candidateMidi = null;
            candidateCount = 0;
            centsEma = null;
            setReading(null, null);
            setStatus(`No pitch (rms=${rms.toFixed(4)}, conf=${confidence.toFixed(2)})`);
            return;
          }
          const midi = freqToMidi(freqHz);
          const centsRaw = wrapCents(centsOffFromMidi(freqHz, midi));
          history.push({ midi, cents: centsRaw, hz: freqHz, conf: confidence, rms });
          if (history.length > HISTORY_N) history.shift();
          const medMidi = Math.round(median(history.map((h) => h.midi)));
          const medCents = median(history.map((h) => h.cents));
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
  }
});
export default require_main();
//# sourceMappingURL=app.js.map
