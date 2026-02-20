# Audio assets (text-only for PR compatibility)

This project embeds its drum/metronome sample WAVs as **base64 data URLs in source code** so pull requests remain text-only (no binary diff upload issues).

See:
- `src/audio/embedded-samples.ts`

The embedded WAV content is procedurally generated for this project and committed as text.
