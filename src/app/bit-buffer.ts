/**
 * BitWriter — appends arbitrary-width unsigned integer values to a bit stream,
 * then exports as a Uint8Array (MSB-first within each byte).
 */
export class BitWriter {
  private bytes: number[] = [];
  private current = 0; // bits accumulated in the current byte (0–7)
  private bits = 0; // value of the current partial byte

  /** Write `width` bits of `value` (MSB first). */
  write(value: number, width: number): void {
    // Mask to the requested width to prevent sign/overflow issues.
    value = value & ((1 << width) - 1);
    for (let i = width - 1; i >= 0; i--) {
      this.bits = (this.bits << 1) | ((value >> i) & 1);
      this.current++;
      if (this.current === 8) {
        this.bytes.push(this.bits);
        this.current = 0;
        this.bits = 0;
      }
    }
  }

  /** Flush any remaining bits (zero-padded) and return the byte array. */
  toBytes(): Uint8Array {
    if (this.current > 0) {
      this.bytes.push(this.bits << (8 - this.current));
    }
    return new Uint8Array(this.bytes);
  }
}

/**
 * BitReader — reads arbitrary-width unsigned integer values from a Uint8Array
 * bit stream (MSB-first within each byte).
 */
export class BitReader {
  private byteIndex = 0;
  private bitIndex = 7; // next bit to read within current byte (7 = MSB)

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.byteIndex >= this.bytes.length;
  }

  /** Read `width` bits and return as an unsigned integer. Throws if out of data. */
  read(width: number): number {
    let result = 0;
    for (let i = 0; i < width; i++) {
      if (this.byteIndex >= this.bytes.length) {
        throw new RangeError("BitReader: read past end of stream");
      }
      const bit = (this.bytes[this.byteIndex]! >> this.bitIndex) & 1;
      result = (result << 1) | bit;
      if (this.bitIndex === 0) {
        this.bitIndex = 7;
        this.byteIndex++;
      } else {
        this.bitIndex--;
      }
    }
    return result;
  }
}

/** Encode a Uint8Array to a URL-safe base64 string (no padding). */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode a URL-safe base64 string back to a Uint8Array. Returns null on error. */
export function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
