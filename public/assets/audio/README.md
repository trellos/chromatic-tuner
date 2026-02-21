# Audio assets (text-only)

The metronome and drum-machine sounds are bundled as base64-encoded WAV one-shots in:

- [`src/audio/embedded-samples.ts`](../../src/audio/embedded-samples.ts)

They are committed as text so PRs do not fail on binary-file diffs.

## Source links / provenance

Current bundled sounds are project-generated one-shots (see file above). For externally sourced free drum samples, these are the reference sources requested for future replacement:

- JS Drum Machine sample set (free/open source project):
  - Repository: https://github.com/jakesgordon/javascript-drum-machine
  - Sounds folder: https://github.com/jakesgordon/javascript-drum-machine/tree/master/sounds
  - License: https://github.com/jakesgordon/javascript-drum-machine/blob/master/LICENSE
- BigSoundBank free SFX catalog (used previously for drum one-shots):
  - Site: https://bigsoundbank.com/
  - Free sound effects category: https://bigsoundbank.com/sound-efects/
  - Terms / license page: https://bigsoundbank.com/terms.html

If/when external samples are re-bundled into this repo, keep their exact upstream file URLs and license references in this section.
