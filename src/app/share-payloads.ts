import type {
  FretboardState,
  DisplayType,
  NoteName,
  ScaleType,
  ChordType,
  KeyModeType,
  CharacteristicType,
  AnnotationType,
} from "../fretboard-logic.js";
import type { CompositeLooperMeasureSlot } from "../ui/ui-composite-looper.js";
import { BitWriter, BitReader, bytesToBase64Url, base64UrlToBytes } from "./bit-buffer.js";

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

// ── V2 bit-packed codec ──────────────────────────────────────────────────────
//
// Bit stream layout:
//   [4]  version = 2
//   [7]  bpm - 60  (range 0–120, covering BPM 60–180)
//   [3]  kit index (see KIT_IDS)
//   [4]  fret root semitone (see NOTE_NAMES)
//   [2]  fret display index (see DISPLAY_TYPES)
//   [8]  fret characteristic index within display-type list (see CHAR_LISTS)
//   [1]  annotation index (see ANNOTATION_TYPES)
//   [64] drum grid: 4 rows × 16 steps, 1 bit each (Kick, Snare, Hat, Perc)
//   per looper (circle then fretboard):
//     [3] measure count (0–4)
//     per measure:
//       [5] event count (0–31)
//       per event:
//         [4] startStep (0–15)
//         [4] endStep - 1 (0–15, representing 1–16)
//         [3] noteCount - 1 (0–7, representing 1–8 notes)
//         per note: [6] midi - 40 (covers range 40–103)

const FORMAT_VERSION_V2 = 2;
const FORMAT_VERSION_V3 = 3;

const KIT_IDS = ["rock", "electro", "house", "lofi", "latin", "woodblock"] as const;

const NOTE_NAMES: NoteName[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const DISPLAY_TYPES: DisplayType[] = ["scale", "chord", "key"];

const SCALE_CHARS: ScaleType[] = ["major", "minor", "minor-pentatonic", "major-pentatonic", "blues"];
const CHORD_CHARS: ChordType[] = [
  "major", "minor", "power", "triad", "seventh",
  "augmented", "suspended-second", "suspended-fourth", "ninth",
];
const KEY_CHARS: KeyModeType[] = [
  "ionian-major", "dorian", "phrygian", "lydian", "mixolydian", "aeolian-minor", "locrian",
];

const CHAR_LISTS: Record<DisplayType, CharacteristicType[]> = {
  scale: SCALE_CHARS,
  chord: CHORD_CHARS,
  key: KEY_CHARS,
};

const ANNOTATION_TYPES: AnnotationType[] = ["notes", "degrees"];

const MIDI_OFFSET = 40;
const MIDI_BITS = 6; // covers 40–103

export function encodeWildTunaTrackPayloadV2(
  payload: WildTunaTrackPayload,
  drumPayload: DrumTrackPayload,
): string {
  const w = new BitWriter();

  // Header
  w.write(FORMAT_VERSION_V2, 4);
  w.write(Math.max(0, Math.min(120, drumPayload.bpm - 60)), 7);

  const kitIdx = KIT_IDS.indexOf(drumPayload.kit as typeof KIT_IDS[number]);
  w.write(kitIdx >= 0 ? kitIdx : 0, 3);

  const rootIdx = NOTE_NAMES.indexOf(payload.fret.root);
  w.write(rootIdx >= 0 ? rootIdx : 0, 4);

  const displayIdx = DISPLAY_TYPES.indexOf(payload.fret.display);
  w.write(displayIdx >= 0 ? displayIdx : 0, 2);

  const charList = CHAR_LISTS[payload.fret.display] as CharacteristicType[];
  const charIdx = charList.indexOf(payload.fret.characteristic);
  w.write(charIdx >= 0 ? charIdx : 0, 8);

  const annotIdx = ANNOTATION_TYPES.indexOf(payload.fret.annotation);
  w.write(annotIdx >= 0 ? annotIdx : 0, 1);

  // Drum grid: 4 rows × 16 steps
  const steps = drumPayload.steps;
  for (let i = 0; i < 64; i++) {
    w.write(steps[i] === "1" ? 1 : 0, 1);
  }

  // Loop sections: circle then fretboard
  for (const loopId of ["circle", "fretboard"] as const) {
    const loopData = payload.loops.find((l) => l.id === loopId);
    const measures = loopData?.measures ?? [];
    w.write(Math.min(measures.length, 7), 3);
    for (const measure of measures) {
      const events = measure.events;
      w.write(Math.min(events.length, 31), 5);
      for (const event of events) {
        w.write(Math.max(0, Math.min(15, event.startStep)), 4);
        w.write(Math.max(0, Math.min(15, event.endStep - 1)), 4);
        const noteCount = Math.max(1, Math.min(8, event.midis.length));
        w.write(noteCount - 1, 3);
        for (let n = 0; n < noteCount; n++) {
          const midi = event.midis[n] ?? event.midis[0] ?? MIDI_OFFSET;
          w.write(Math.max(0, Math.min(63, midi - MIDI_OFFSET)), MIDI_BITS);
        }
      }
    }
  }

  return bytesToBase64Url(w.toBytes());
}

export function decodeWildTunaTrackPayloadV2(
  encoded: string,
): DecodeResult<{ payload: WildTunaTrackPayload; drumPayload: DrumTrackPayload }> {
  const bytes = base64UrlToBytes(encoded);
  if (!bytes) return { ok: false, reason: "invalid-base64" };

  try {
    const r = new BitReader(bytes);

    const version = r.read(4);
    if (version !== FORMAT_VERSION_V2) return { ok: false, reason: "unsupported-version" };

    const bpm = r.read(7) + 60;
    const kitIdx = r.read(3);
    const kit = KIT_IDS[kitIdx] ?? "rock";

    const rootIdx = r.read(4);
    const root = NOTE_NAMES[rootIdx] ?? "C";

    const displayIdx = r.read(2);
    const display = DISPLAY_TYPES[displayIdx] ?? "scale";

    const charIdx = r.read(8);
    const charList = CHAR_LISTS[display] as CharacteristicType[];
    const characteristic = (charList[charIdx] ?? charList[0]) as CharacteristicType;

    const annotIdx = r.read(1);
    const annotation = ANNOTATION_TYPES[annotIdx] ?? "notes";

    // Drum grid
    let stepsStr = "";
    for (let i = 0; i < 64; i++) stepsStr += r.read(1) === 1 ? "1" : "0";

    const drumPayload: DrumTrackPayload = { version: 1, bpm, kit, steps: stepsStr };

    // Loops
    const loops: WildTunaLoopPayload[] = [];
    for (const loopId of ["circle", "fretboard"] as const) {
      const measureCount = r.read(3);
      const measures: CompositeLooperMeasureSlot[] = [];
      for (let m = 0; m < measureCount; m++) {
        const eventCount = r.read(5);
        const events: CompositeLooperMeasureSlot["events"] = [];
        for (let e = 0; e < eventCount; e++) {
          const startStep = r.read(4);
          const endStep = r.read(4) + 1;
          const noteCount = r.read(3) + 1;
          const midis: number[] = [];
          for (let n = 0; n < noteCount; n++) {
            midis.push(r.read(MIDI_BITS) + MIDI_OFFSET);
          }
          events.push({ startStep, endStep, midis });
        }
        measures.push({ events });
      }
      loops.push({ id: loopId, measures });
    }

    const fret: FretboardState = { root, display, characteristic, annotation };

    // Re-encode drum payload as v1 JSON string (what WildTunaTrackPayload.drum expects)
    const drumEncoded = toBase64Url(JSON.stringify(drumPayload));

    return {
      ok: true,
      value: {
        payload: { v: 1, drum: drumEncoded, fret, loops },
        drumPayload,
      },
    };
  } catch {
    return { ok: false, reason: "schema-mismatch" };
  }
}

// V3 bit stream layout — identical to V2 except:
//   after [1] annotation: [1] isEightStep flag
//   drum grid: (isEightStep ? 32 : 64) bits instead of always 64
//
// This allows encoding 8-step (eighth-note) drum patterns in the share URL.

export function encodeWildTunaTrackPayloadV3(
  payload: WildTunaTrackPayload,
  drumPayload: DrumTrackPayload,
): string {
  const w = new BitWriter();

  w.write(FORMAT_VERSION_V3, 4);
  w.write(Math.max(0, Math.min(120, drumPayload.bpm - 60)), 7);

  const kitIdx = KIT_IDS.indexOf(drumPayload.kit as typeof KIT_IDS[number]);
  w.write(kitIdx >= 0 ? kitIdx : 0, 3);

  const rootIdx = NOTE_NAMES.indexOf(payload.fret.root);
  w.write(rootIdx >= 0 ? rootIdx : 0, 4);

  const displayIdx = DISPLAY_TYPES.indexOf(payload.fret.display);
  w.write(displayIdx >= 0 ? displayIdx : 0, 2);

  const charList = CHAR_LISTS[payload.fret.display] as CharacteristicType[];
  const charIdx = charList.indexOf(payload.fret.characteristic);
  w.write(charIdx >= 0 ? charIdx : 0, 8);

  const annotIdx = ANNOTATION_TYPES.indexOf(payload.fret.annotation);
  w.write(annotIdx >= 0 ? annotIdx : 0, 1);

  // Step mode flag: 1 = 8-step, 0 = 16-step (inferred from steps string length)
  const steps = drumPayload.steps;
  const isEightStep = steps.length === 32;
  w.write(isEightStep ? 1 : 0, 1);

  // Drum grid: 32 or 64 bits
  const gridBits = isEightStep ? 32 : 64;
  for (let i = 0; i < gridBits; i++) {
    w.write(steps[i] === "1" ? 1 : 0, 1);
  }

  for (const loopId of ["circle", "fretboard"] as const) {
    const loopData = payload.loops.find((l) => l.id === loopId);
    const measures = loopData?.measures ?? [];
    w.write(Math.min(measures.length, 7), 3);
    for (const measure of measures) {
      const events = measure.events;
      w.write(Math.min(events.length, 31), 5);
      for (const event of events) {
        w.write(Math.max(0, Math.min(15, event.startStep)), 4);
        w.write(Math.max(0, Math.min(15, event.endStep - 1)), 4);
        const noteCount = Math.max(1, Math.min(8, event.midis.length));
        w.write(noteCount - 1, 3);
        for (let n = 0; n < noteCount; n++) {
          const midi = event.midis[n] ?? event.midis[0] ?? MIDI_OFFSET;
          w.write(Math.max(0, Math.min(63, midi - MIDI_OFFSET)), MIDI_BITS);
        }
      }
    }
  }

  return bytesToBase64Url(w.toBytes());
}

export function decodeWildTunaTrackPayloadV3(
  encoded: string,
): DecodeResult<{ payload: WildTunaTrackPayload; drumPayload: DrumTrackPayload }> {
  const bytes = base64UrlToBytes(encoded);
  if (!bytes) return { ok: false, reason: "invalid-base64" };

  try {
    const r = new BitReader(bytes);

    const version = r.read(4);
    if (version !== FORMAT_VERSION_V3) return { ok: false, reason: "unsupported-version" };

    const bpm = r.read(7) + 60;
    const kitIdx = r.read(3);
    const kit = KIT_IDS[kitIdx] ?? "rock";

    const rootIdx = r.read(4);
    const root = NOTE_NAMES[rootIdx] ?? "C";

    const displayIdx = r.read(2);
    const display = DISPLAY_TYPES[displayIdx] ?? "scale";

    const charIdx = r.read(8);
    const charList = CHAR_LISTS[display] as CharacteristicType[];
    const characteristic = (charList[charIdx] ?? charList[0]) as CharacteristicType;

    const annotIdx = r.read(1);
    const annotation = ANNOTATION_TYPES[annotIdx] ?? "notes";

    // Step mode flag
    const isEightStep = r.read(1) === 1;
    const gridBits = isEightStep ? 32 : 64;

    let stepsStr = "";
    for (let i = 0; i < gridBits; i++) stepsStr += r.read(1) === 1 ? "1" : "0";

    const drumPayload: DrumTrackPayload = { version: 1, bpm, kit, steps: stepsStr };

    const loops: WildTunaLoopPayload[] = [];
    for (const loopId of ["circle", "fretboard"] as const) {
      const measureCount = r.read(3);
      const measures: CompositeLooperMeasureSlot[] = [];
      for (let m = 0; m < measureCount; m++) {
        const eventCount = r.read(5);
        const events: CompositeLooperMeasureSlot["events"] = [];
        for (let e = 0; e < eventCount; e++) {
          const startStep = r.read(4);
          const endStep = r.read(4) + 1;
          const noteCount = r.read(3) + 1;
          const midis: number[] = [];
          for (let n = 0; n < noteCount; n++) {
            midis.push(r.read(MIDI_BITS) + MIDI_OFFSET);
          }
          events.push({ startStep, endStep, midis });
        }
        measures.push({ events });
      }
      loops.push({ id: loopId, measures });
    }

    const fret: FretboardState = { root, display, characteristic, annotation };
    const drumEncoded = toBase64Url(JSON.stringify(drumPayload));

    return {
      ok: true,
      value: {
        payload: { v: 1, drum: drumEncoded, fret, loops },
        drumPayload,
      },
    };
  } catch {
    return { ok: false, reason: "schema-mismatch" };
  }
}

/**
 * Attempt to decode a Wild Tuna track URL parameter, trying v3 then v2 bit-packed
 * format, then falling back to v1 JSON format.
 */
export function decodeWildTunaTrackParam(
  encoded: string,
): DecodeResult<WildTunaTrackPayload> {
  // Peek at version: decode first byte and check top 4 bits.
  const bytes = base64UrlToBytes(encoded);
  if (bytes && bytes.length > 0) {
    const version = (bytes[0]! >> 4) & 0xf;
    if (version === FORMAT_VERSION_V3) {
      const result = decodeWildTunaTrackPayloadV3(encoded);
      if (result.ok) return { ok: true, value: result.value.payload };
    }
    if (version === FORMAT_VERSION_V2) {
      const result = decodeWildTunaTrackPayloadV2(encoded);
      if (result.ok) return { ok: true, value: result.value.payload };
    }
  }
  // Fall back to v1 JSON
  return decodeWildTunaTrackPayload(encoded);
}
