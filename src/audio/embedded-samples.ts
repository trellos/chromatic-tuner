// Bundled sample file URLs served from public/assets/audio.

export const METRONOME_SAMPLE_URLS = {
  electroRegular: "assets/audio/metronome/electro-regular.wav",
  electroAccent: "assets/audio/metronome/electro-accent.wav",
  drumRegular: "assets/audio/metronome/drum-regular.wav",
  drumAccent: "assets/audio/metronome/drum-accent.wav",
  congaRegular: "assets/audio/metronome/conga-regular.wav",
  congaAccent: "assets/audio/metronome/conga-accent.wav",
} as const;

export const DRUM_MACHINE_SAMPLE_URLS = {
  rock: {
    kick: "assets/audio/drum-machine/rock-kick.wav",
    snare: "assets/audio/drum-machine/rock-snare.wav",
    hat: "assets/audio/drum-machine/rock-hat.wav",
    perc: "assets/audio/drum-machine/rock-perc.wav",
  },
  electro: {
    kick: "assets/audio/drum-machine/electro-kick.wav",
    snare: "assets/audio/drum-machine/electro-snare.wav",
    hat: "assets/audio/drum-machine/electro-hat.wav",
    perc: "assets/audio/drum-machine/electro-perc.wav",
  },
  house: {
    kick: "assets/audio/drum-machine/house-kick.wav",
    snare: "assets/audio/drum-machine/house-snare.wav",
    hat: "assets/audio/drum-machine/house-hat.wav",
    perc: "assets/audio/drum-machine/house-perc.wav",
  },
  lofi: {
    kick: "assets/audio/drum-machine/lofi-kick.wav",
    snare: "assets/audio/drum-machine/lofi-snare.wav",
    hat: "assets/audio/drum-machine/lofi-hat.wav",
    perc: "assets/audio/drum-machine/lofi-perc.wav",
  },
  latin: {
    kick: "assets/audio/drum-machine/latin-kick.wav",
    snare: "assets/audio/drum-machine/latin-snare.wav",
    hat: "assets/audio/drum-machine/latin-hat.wav",
    perc: "assets/audio/drum-machine/latin-perc.wav",
  },
} as const;
