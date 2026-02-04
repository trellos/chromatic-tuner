const startButton = document.getElementById("start") as HTMLButtonElement | null;
const statusEl = document.getElementById("status");
const noteEl = document.getElementById("note");
const centsEl = document.getElementById("cents");

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
      autoGainControl: false
    }
  });

  setStatus("Creating AudioContext…");
  audioContext = new AudioContext({ latencyHint: "interactive" });
  await audioContext.resume();

  setStatus("Loading worklet module…");
  try {
    await audioContext.audioWorklet.addModule("/assets/worklet.js");
  } catch (e) {
    console.error("addModule failed", e);
    setStatus("Error: addModule() failed. Check console + /assets/worklet.js");
    throw e;
  }

  setStatus("Creating audio graph…");
  const source = audioContext.createMediaStreamSource(micStream);

  workletNode = new AudioWorkletNode(audioContext, "passthrough");

  workletNode.port.onmessage = (ev) => {
    const data = ev.data as any;
    if (data?.type === "worklet-ready") {
      setStatus(`Worklet running. sampleRate=${data.sampleRate}`);
    } else {
      setStatus(`Worklet message: ${JSON.stringify(data)}`);
    }
  };

  // Connect mic -> worklet. (No need to connect to destination for analysis.)
  source.connect(workletNode);

  // Keep output disconnected for now to avoid feedback.
  // If you ever need to ensure processing continues, we can connect to a GainNode(0).
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
