var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/audio/worklet.ts
var require_worklet = __commonJS({
  "src/audio/worklet.ts"() {
    var PassthroughProcessor = class extends AudioWorkletProcessor {
      constructor() {
        super(...arguments);
        __publicField(this, "sent", false);
      }
      process(inputs) {
        if (!this.sent) {
          this.sent = true;
          this.port.postMessage({ type: "worklet-ready", sampleRate });
        }
        return true;
      }
    };
    registerProcessor("passthrough", PassthroughProcessor);
  }
});
export default require_worklet();
//# sourceMappingURL=worklet.js.map
