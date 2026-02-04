var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/audio/worklet.ts
var require_worklet = __commonJS({
  "src/audio/worklet.ts"() {
    var PassthroughProcessor = class extends AudioWorkletProcessor {
      process(_inputs) {
        return true;
      }
    };
    registerProcessor("passthrough", PassthroughProcessor);
  }
});
export default require_worklet();
//# sourceMappingURL=worklet.js.map
