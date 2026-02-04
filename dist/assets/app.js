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
      try {
        await audioContext.audioWorklet.addModule("/assets/worklet.js");
      } catch (e) {
        console.error("addModule failed", e);
        setStatus("Error: addModule() failed. Check console + /assets/worklet.js");
        throw e;
      }
      setStatus("Creating audio graph\u2026");
      const source = audioContext.createMediaStreamSource(micStream);
      workletNode = new AudioWorkletNode(audioContext, "passthrough");
      workletNode.port.onmessage = (ev) => {
        const data = ev.data;
        if (data?.type === "worklet-ready") {
          setStatus(`Worklet running. sampleRate=${data.sampleRate}`);
        } else {
          setStatus(`Worklet message: ${JSON.stringify(data)}`);
        }
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
