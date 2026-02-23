# Audio assets

Metronome and drum-machine samples are now stored as `.wav` files under this directory and loaded via URL constants in:

- [`src/audio/embedded-samples.ts`](../../src/audio/embedded-samples.ts)
- [`src/audio/woodblock-samples.ts`](../../src/audio/woodblock-samples.ts)

## Layout

- `metronome/*.wav`: one-shots for metronome sound profiles (`woodblock`, `electro`, `drum`, `conga`) with regular/accent hits.
- `drum-machine/*.wav`: one-shots for kit voices (`kick`, `snare`, `hat`, `perc`) across kits.
- `fretboard/*.mp3`: single-note guitar sample used for fretboard dot tap playback.
- `circle/*.mp3`: single-note samples used by circle-of-fifths instrument switching.
  - Circle sustain playback derives zero-crossing loop points at runtime for hold-to-sustain wedge interaction.

## Provenance

Current assets were decoded from the prior in-repo embedded WAV data URLs generated for this project.

Fretboard sample:

- `fretboard/guitar-acoustic-c4.mp3` from `tonejs-instrument-guitar-acoustic-mp3` (`MIT`), downloaded from:
  - `https://cdn.jsdelivr.net/npm/tonejs-instrument-guitar-acoustic-mp3@1.0.0/C4.mp3`

Circle mode samples:

- `circle/guitar-acoustic-c4.mp3` from `tonejs-instrument-guitar-acoustic-mp3` (`MIT`):
  - `https://cdn.jsdelivr.net/npm/tonejs-instrument-guitar-acoustic-mp3@1.0.0/C4.mp3`
- `circle/guitar-electric-c4.mp3` from `tonejs-instrument-guitar-electric-mp3` (`MIT`):
  - `https://cdn.jsdelivr.net/npm/tonejs-instrument-guitar-electric-mp3@1.0.0/C4.mp3`
- `circle/guitar-spanish-cs4.mp3` from `tonejs-instrument-guitar-nylon-mp3` (`MIT`):
  - `https://cdn.jsdelivr.net/npm/tonejs-instrument-guitar-nylon-mp3@1.0.0/Cs4.mp3`
- `circle/organ-pipe-c4.mp3` from `tonejs-instrument-organ-mp3` (`MIT`):
  - `https://cdn.jsdelivr.net/npm/tonejs-instrument-organ-mp3@1.0.0/C4.mp3`
- `circle/organ-house-c4.mp3` from `tonejs-instrument-harmonium-mp3` (`MIT`):
  - `https://cdn.jsdelivr.net/npm/tonejs-instrument-harmonium-mp3@1.0.0/C4.mp3`
