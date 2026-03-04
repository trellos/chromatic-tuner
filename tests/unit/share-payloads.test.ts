import { describe, expect, it } from "vitest";
import {
  decodeDrumTrackPayload,
  decodeWildTunaTrackPayload,
  encodeDrumTrackPayload,
  encodeWildTunaTrackPayload,
} from "../../src/app/share-payloads.js";

describe("share-payloads", () => {
  it("round-trips drum payload and accepts legacy v key", () => {
    const encoded = encodeDrumTrackPayload({
      version: 1,
      bpm: 128,
      kit: "rock",
      steps: "1010",
    });
    const decoded = decodeDrumTrackPayload(encoded);
    expect(decoded).toEqual({
      ok: true,
      value: {
        version: 1,
        bpm: 128,
        kit: "rock",
        steps: "1010",
      },
    });

    const legacy = btoa(JSON.stringify({ v: 1, bpm: 90, kit: "latin", steps: "0011" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    const decodedLegacy = decodeDrumTrackPayload(legacy);
    expect(decodedLegacy.ok).toBe(true);
    expect(decodedLegacy.ok && decodedLegacy.value.version).toBe(1);
  });

  it("reports structured failures", () => {
    expect(decodeDrumTrackPayload("***")).toEqual({ ok: false, reason: "invalid-base64" });

    const badVersion = btoa(JSON.stringify({ version: 2, bpm: 120, kit: "rock", steps: "1010" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    expect(decodeDrumTrackPayload(badVersion)).toEqual({ ok: false, reason: "unsupported-version" });
  });

  it("round-trips wild tuna payload and validates schema", () => {
    const encoded = encodeWildTunaTrackPayload({
      v: 1,
      drum: "abc",
      fret: { root: "C", display: "scale", characteristic: "major", annotation: "notes" },
      loops: [{ id: "circle", measures: [{ events: [] }] }],
    });
    const decoded = decodeWildTunaTrackPayload(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.v).toBe(1);
    expect(decoded.value.loops[0]?.id).toBe("circle");

    const badSchema = btoa(JSON.stringify({ v: 1, drum: "abc", fret: null, loops: [] }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    expect(decodeWildTunaTrackPayload(badSchema)).toEqual({ ok: false, reason: "schema-mismatch" });
  });
});
