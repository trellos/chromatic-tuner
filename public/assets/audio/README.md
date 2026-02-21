# Audio assets (text-only)

All metronome and drum-machine sounds are bundled as base64-encoded WAV one-shots in source files:

- [`src/audio/embedded-samples.ts`](../../src/audio/embedded-samples.ts)
- [`src/audio/woodblock-samples.ts`](../../src/audio/woodblock-samples.ts)

This keeps audio diffs text-only, which avoids binary patch limitations in PR tooling.

## Source links / provenance

Current bundled sounds are project-generated one-shots.

Woodblock one-shots were generated in-repo for offline use with a short percussive synthesis script (no third-party redistribution dependency required).
