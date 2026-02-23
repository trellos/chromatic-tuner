import { expect, test } from "@playwright/test";
import {
  DRUM_MACHINE_SAMPLE_URLS,
  METRONOME_SAMPLE_URLS,
} from "../src/audio/embedded-samples.js";
import { WOODBLOCK_SAMPLE_URLS } from "../src/audio/woodblock-samples.js";

function collectUrls(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];

  return Object.values(value).flatMap((entry) => collectUrls(entry));
}

test("bundled audio URLs are base-path-safe and resolve from app location", () => {
  const urls = [
    ...collectUrls(METRONOME_SAMPLE_URLS),
    ...collectUrls(DRUM_MACHINE_SAMPLE_URLS),
    ...collectUrls(WOODBLOCK_SAMPLE_URLS),
  ];

  expect(urls.length).toBe(32);

  const repoBaseUrl = "https://example.com/chromatic-tuner/index.html?mode=metronome";

  for (const url of urls) {
    expect(url.startsWith("/"), `${url} should not be root-absolute`).toBeFalsy();
    expect(url).toMatch(/^assets\/audio\/.+\.wav$/);

    const resolved = new URL(url, repoBaseUrl);
    expect(resolved.pathname).toMatch(/^\/chromatic-tuner\/assets\/audio\/.+\.wav$/);
  }
});
