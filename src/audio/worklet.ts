/// <reference lib="webworker" />

class PassthroughProcessor extends AudioWorkletProcessor {
  private sent = false;

  process(inputs: Float32Array[][]) {
    // Prove the worklet is actually running by sending one message back.
    if (!this.sent) {
      this.sent = true;
      this.port.postMessage({ type: "worklet-ready", sampleRate });
    }

    // We'll process real audio later; for now just keep the node alive.
    // inputs[0][0] is the first channel's samples if present.
    return true;
  }
}

registerProcessor("passthrough", PassthroughProcessor);
