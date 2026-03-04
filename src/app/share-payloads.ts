import type { FretboardState } from "../fretboard-logic.js";
import type { CompositeLooperMeasureSlot } from "../ui/ui-composite-looper.js";

export type DecodeErrorReason =
  | "invalid-base64"
  | "invalid-json"
  | "unsupported-version"
  | "schema-mismatch";

export type DecodeSuccess<T> = { ok: true; value: T };
export type DecodeFailure = { ok: false; reason: DecodeErrorReason };
export type DecodeResult<T> = DecodeSuccess<T> | DecodeFailure;

export type DrumTrackPayload = {
  version: 1;
  bpm: number;
  kit: string;
  steps: string;
};

export type WildTunaLoopPayload = { id: string; measures: CompositeLooperMeasureSlot[] };
export type WildTunaTrackPayload = {
  v: 1;
  drum: string;
  fret: FretboardState;
  loops: WildTunaLoopPayload[];
};

export const toBase64Url = (value: string): string =>
  btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

export const fromBase64Url = (value: string): DecodeResult<string> => {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    return { ok: true, value: atob(padded) };
  } catch {
    return { ok: false, reason: "invalid-base64" };
  }
};

function parseJsonObject(raw: string): DecodeResult<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "schema-mismatch" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
}

export function encodeDrumTrackPayload(payload: DrumTrackPayload): string {
  return toBase64Url(JSON.stringify(payload));
}

export function decodeDrumTrackPayload(encoded: string): DecodeResult<DrumTrackPayload> {
  const decoded = fromBase64Url(encoded);
  if (!decoded.ok) return decoded;
  const parsed = parseJsonObject(decoded.value);
  if (!parsed.ok) return parsed;

  const version =
    typeof parsed.value.version === "number"
      ? parsed.value.version
      : typeof parsed.value.v === "number"
        ? parsed.value.v
        : null;

  if (version !== 1) return { ok: false, reason: "unsupported-version" };
  if (
    typeof parsed.value.bpm !== "number" ||
    typeof parsed.value.kit !== "string" ||
    typeof parsed.value.steps !== "string"
  ) {
    return { ok: false, reason: "schema-mismatch" };
  }

  return {
    ok: true,
    value: {
      version: 1,
      bpm: parsed.value.bpm,
      kit: parsed.value.kit,
      steps: parsed.value.steps,
    },
  };
}

export function encodeWildTunaTrackPayload(payload: WildTunaTrackPayload): string {
  return toBase64Url(JSON.stringify(payload));
}

export function decodeWildTunaTrackPayload(encoded: string): DecodeResult<WildTunaTrackPayload> {
  const decoded = fromBase64Url(encoded);
  if (!decoded.ok) return decoded;
  const parsed = parseJsonObject(decoded.value);
  if (!parsed.ok) return parsed;

  if (parsed.value.v !== 1) return { ok: false, reason: "unsupported-version" };
  if (typeof parsed.value.drum !== "string") return { ok: false, reason: "schema-mismatch" };
  if (!parsed.value.fret || typeof parsed.value.fret !== "object" || Array.isArray(parsed.value.fret)) {
    return { ok: false, reason: "schema-mismatch" };
  }
  if (!Array.isArray(parsed.value.loops)) return { ok: false, reason: "schema-mismatch" };

  return {
    ok: true,
    value: {
      v: 1,
      drum: parsed.value.drum,
      fret: parsed.value.fret as FretboardState,
      loops: parsed.value.loops as WildTunaLoopPayload[],
    },
  };
}
