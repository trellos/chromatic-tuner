// Minimal placeholder worklet so bundling works.
class PassthroughProcessor extends AudioWorkletProcessor {
  process(_inputs: Float32Array[][]) {
    return true;
  }
}

registerProcessor("passthrough", PassthroughProcessor);
