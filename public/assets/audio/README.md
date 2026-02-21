# Audio assets

Metronome and drum-machine samples are now stored as `.wav` files under this directory and loaded via URL constants in:

- [`src/audio/embedded-samples.ts`](../../src/audio/embedded-samples.ts)
- [`src/audio/woodblock-samples.ts`](../../src/audio/woodblock-samples.ts)

## Layout

- `metronome/*.wav`: one-shots for metronome sound profiles (`woodblock`, `electro`, `drum`, `conga`) with regular/accent hits.
- `drum-machine/*.wav`: one-shots for kit voices (`kick`, `snare`, `hat`, `perc`) across kits.

## Provenance

Current assets were decoded from the prior in-repo embedded WAV data URLs generated for this project.
