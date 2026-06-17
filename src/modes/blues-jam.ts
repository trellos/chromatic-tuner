import type { ModeDefinition } from "./types.js";
import { clamp } from "../utils.js";
import { createAudioContextService } from "../app/audio-context-service.js";
import {
  BLUES_KEYS,
  BLUES_PROGRESSIONS,
  BASS_STYLES,
  getBassStyle,
  type BluesKey,
  type BluesProgressionId,
  type BassStyleId,
  type BassFeel,
  type ResolvedBar,
  resolveProgression,
  gridRowsForBarCount,
  midiToFrequency,
} from "./blues-jam-logic.js";

// Blues Jam mode: pick a key, tempo, progression, and bass style, then loop a
// blues-rock backing track — drums + bass, with optional chord comping. A grid
// shows the
// chord per measure (current one highlighted) and a 4-dot visual metronome
// swells on each beat. Audio is fully self-contained (Web Audio synthesis), in
// the spirit of the metronome mode.
export function createBluesJamMode(): ModeDefinition {
  const screenEl = document.querySelector<HTMLElement>(
    '.mode-screen[data-mode="blues-jam"]'
  );

  const TEMPO_MIN = 60;
  const TEMPO_MAX = 160;
  const BEATS_PER_BAR = 4;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD = 0.12;
  // Even eighths land halfway through the beat; shuffle feels push them to 2/3.
  const STRAIGHT = 0.5;
  const SHUFFLE = 2 / 3;

  const KEY_STORAGE = "tuna.bluesJam.key";
  const TEMPO_STORAGE = "tuna.bluesJam.tempo";
  const PROG_STORAGE = "tuna.bluesJam.progression";
  const CHORDS_STORAGE = "tuna.bluesJam.chords";
  const BASS_STORAGE = "tuna.bluesJam.bass";
  const BASS_SOUND_STORAGE = "tuna.bluesJam.bassSound";

  const BASS_VOL_STORAGE = "tuna.bluesJam.bassVol";
  const CHORD_VOL_STORAGE = "tuna.bluesJam.chordVol";

  let key: BluesKey = "A";
  let tempo = 100;
  let progressionId: BluesProgressionId = "twelve-bar";
  let bassStyleId: BassStyleId = "tight-pocket";
  let bassSoundId: BassSoundId = "option-1";
  let chordsEnabled = false;
  let bassVolume = 0.6;
  let chordVolume = 0.85;

  let bars: ResolvedBar[] = [];
  let cellEls: HTMLButtonElement[] = [];
  let dotEls: HTMLElement[] = [];

  const audioService = createAudioContextService();
  let audioContext: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let bassBus: GainNode | null = null;
  let chordBus: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;

  let isPlaying = false;
  let schedulerId: number | null = null;
  let rafId: number | null = null;
  let nextBeatTime = 0;
  let nextBeatIndex = 0; // global beat counter since playback start
  let playbackStartTime = 0;
  let highlightedBar = -1;
  let activeDot = -1;
  let uiAbort: AbortController | null = null;

  // --- DOM references (resolved in enterMode) ----------------------------

  let keyRowEl: HTMLElement | null = null;
  let tempoInputEl: HTMLInputElement | null = null;
  let tempoValueEl: HTMLElement | null = null;
  let progressionSelectEl: HTMLSelectElement | null = null;
  let bassSelectEl: HTMLSelectElement | null = null;
  let bassSoundSelectEl: HTMLSelectElement | null = null;
  let chordsToggleEl: HTMLInputElement | null = null;
  let bassVolInputEl: HTMLInputElement | null = null;
  let bassVolValueEl: HTMLElement | null = null;
  let chordVolInputEl: HTMLInputElement | null = null;
  let chordVolValueEl: HTMLElement | null = null;
  let chordVolControlEl: HTMLElement | null = null;
  let toggleButtonEl: HTMLButtonElement | null = null;
  let gridEl: HTMLElement | null = null;
  let metronomeEl: HTMLElement | null = null;

  // --- Persistence -------------------------------------------------------

  const readStored = () => {
    try {
      const storedKey = window.localStorage.getItem(KEY_STORAGE);
      if (storedKey && (BLUES_KEYS as readonly string[]).includes(storedKey)) {
        key = storedKey as BluesKey;
      }
      const storedTempo = Number.parseInt(
        window.localStorage.getItem(TEMPO_STORAGE) ?? "",
        10
      );
      if (Number.isFinite(storedTempo)) {
        tempo = clamp(storedTempo, TEMPO_MIN, TEMPO_MAX);
      }
      const storedProg = window.localStorage.getItem(PROG_STORAGE);
      if (storedProg && BLUES_PROGRESSIONS.some((p) => p.id === storedProg)) {
        progressionId = storedProg as BluesProgressionId;
      }
      const storedBass = window.localStorage.getItem(BASS_STORAGE);
      if (storedBass && BASS_STYLES.some((s) => s.id === storedBass)) {
        bassStyleId = storedBass as BassStyleId;
      }
      const storedBassSound = window.localStorage.getItem(BASS_SOUND_STORAGE);
      if (storedBassSound && BASS_VOICES.some((v) => v.id === storedBassSound)) {
        bassSoundId = storedBassSound as BassSoundId;
      }
      chordsEnabled = window.localStorage.getItem(CHORDS_STORAGE) === "1";
      const storedBassVol = Number.parseFloat(
        window.localStorage.getItem(BASS_VOL_STORAGE) ?? ""
      );
      if (Number.isFinite(storedBassVol)) {
        bassVolume = clamp(storedBassVol, 0, 1);
      }
      const storedChordVol = Number.parseFloat(
        window.localStorage.getItem(CHORD_VOL_STORAGE) ?? ""
      );
      if (Number.isFinite(storedChordVol)) {
        chordVolume = clamp(storedChordVol, 0, 1);
      }
    } catch {
      // Ignore storage failures (private mode / restricted environments).
    }
  };

  const persist = (storageKey: string, value: string) => {
    try {
      window.localStorage.setItem(storageKey, value);
    } catch {
      // Ignore storage failures.
    }
  };

  // --- Audio -------------------------------------------------------------

  const ensureAudio = async () => {
    if (audioContext) {
      await audioContext.resume();
      return;
    }
    audioContext = await audioService.createContext();
    await audioContext.resume();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.9;
    // A transparent safety limiter catches peaks so chord stabs can punch
    // through without clipping — high threshold so it does not duck the comp.
    const limiter = audioContext.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 6;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    masterGain.connect(limiter);
    limiter.connect(audioContext.destination);

    // Dedicated buses so the Bass / Chords volume sliders control each part.
    bassBus = audioContext.createGain();
    bassBus.gain.value = bassVolume;
    bassBus.connect(masterGain);
    chordBus = audioContext.createGain();
    chordBus.gain.value = chordVolume;
    chordBus.connect(masterGain);

    // Pre-render a short white-noise buffer for snare/hihat synthesis.
    const length = Math.floor(audioContext.sampleRate * 0.4);
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    noiseBuffer = buffer;
  };

  const playKick = (time: number) => {
    if (!audioContext || !masterGain) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(48, time + 0.12);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.9, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(time);
    osc.stop(time + 0.24);
  };

  const playNoiseHit = (
    time: number,
    duration: number,
    gainValue: number,
    highpass: number
  ) => {
    if (!audioContext || !masterGain || !noiseBuffer) return;
    const source = audioContext.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = audioContext.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = highpass;
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(gainValue, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    source.start(time);
    source.stop(time + duration + 0.02);
  };

  const playSnare = (time: number) => {
    playNoiseHit(time, 0.18, 0.5, 1400);
    // A little body under the noise.
    if (!audioContext || !masterGain) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, time);
    gain.gain.setValueAtTime(0.25, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(time);
    osc.stop(time + 0.14);
  };

  const playHiHat = (time: number, accent: boolean) => {
    playNoiseHit(time, accent ? 0.06 : 0.035, accent ? 0.22 : 0.13, 7000);
  };

  // Bass voices ported from OutrunAxe's Eddie modes (Battle / Cliff Diver use
  // EddieBass). Every voice shares the same architecture — a sine SUB (the body)
  // plus a BITE layer (the edge, slightly detuned) summed into a shared lowpass
  // whose cutoff snaps from a peak down to a floor on the attack (that fast
  // filter envelope is the pluck "bite") — and differs in wave blend, filter
  // shape, and decay. option-6 adds an octave-up layer and a finger-pop noise
  // transient for a slap-bass character. See OutrunAxe src/audio/eddie/EddieBass.ts.
  type BassSoundId =
    | "option-1"
    | "option-2"
    | "option-3"
    | "option-4"
    | "option-5"
    | "option-6";

  type BassVoice = {
    id: BassSoundId;
    label: string;
    biteWave: OscillatorType;
    subGain: number;
    biteGain: number;
    filterFloor: number;
    filterPeak: number;
    filterDecay: number;
    filterQ: number;
    ampSustainFrac: number;
    biteDetune: number;
    level: number; // per-voice output (EddieBass masterGain) for relative balance
    octaveBite?: number;
    transientGain?: number;
    transientHpHz?: number;
  };

  const BASS_VOICES: BassVoice[] = [
    {
      id: "option-1", label: "Pluck Bass", biteWave: "square",
      subGain: 0.5, biteGain: 0.18, filterFloor: 320, filterPeak: 2200,
      filterDecay: 0.09, filterQ: 4, ampSustainFrac: 0.85, biteDetune: 6, level: 0.5,
    },
    {
      id: "option-2", label: "Acid Growl", biteWave: "sawtooth",
      subGain: 0.46, biteGain: 0.26, filterFloor: 240, filterPeak: 2800,
      filterDecay: 0.18, filterQ: 7, ampSustainFrac: 0.92, biteDetune: 10, level: 0.48,
    },
    {
      id: "option-3", label: "Staccato", biteWave: "square",
      subGain: 0.55, biteGain: 0.14, filterFloor: 420, filterPeak: 1800,
      filterDecay: 0.05, filterQ: 3, ampSustainFrac: 0.45, biteDetune: 4, level: 0.52,
    },
    {
      id: "option-4", label: "Deep Rumble", biteWave: "triangle",
      subGain: 0.62, biteGain: 0.1, filterFloor: 140, filterPeak: 520,
      filterDecay: 0.3, filterQ: 2, ampSustainFrac: 1.0, biteDetune: 8, level: 0.5,
    },
    {
      id: "option-5", label: "Techno Stab", biteWave: "sawtooth",
      subGain: 0.5, biteGain: 0.3, filterFloor: 260, filterPeak: 1600,
      filterDecay: 0.04, filterQ: 6, ampSustainFrac: 0.22, biteDetune: 6, level: 0.52,
    },
    {
      id: "option-6", label: "Slap Bass", biteWave: "sawtooth",
      subGain: 0.42, biteGain: 0.22, filterFloor: 300, filterPeak: 3200,
      filterDecay: 0.07, filterQ: 5, ampSustainFrac: 0.5, biteDetune: 5, level: 0.5,
      octaveBite: 0.1, transientGain: 0.5, transientHpHz: 2200,
    },
  ];

  const getBassVoice = (id: BassSoundId): BassVoice =>
    BASS_VOICES.find((v) => v.id === id) ?? BASS_VOICES[0]!;

  const playBassNote = (midi: number, time: number, duration: number) => {
    if (!audioContext || !bassBus) return;
    const v = getBassVoice(bassSoundId);
    const freq = midiToFrequency(midi);
    const ampDur = Math.max(0.08, duration * v.ampSustainFrac);

    // Shared per-note lowpass with a fast envelope = the bite.
    const filter = audioContext.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = v.filterQ;
    filter.frequency.setValueAtTime(v.filterPeak, time);
    filter.frequency.exponentialRampToValueAtTime(v.filterFloor, time + v.filterDecay);

    const amp = audioContext.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(1.0, time + 0.008); // fast attack snap
    amp.gain.setValueAtTime(1.0, time + Math.min(0.05, ampDur * 0.3));
    amp.gain.exponentialRampToValueAtTime(0.0001, time + ampDur);
    // Per-voice output level keeps the variants balanced before the bass bus.
    const voiceOut = audioContext.createGain();
    voiceOut.gain.value = v.level;
    filter.connect(amp);
    amp.connect(voiceOut);
    voiceOut.connect(bassBus);

    // Sub layer (the body).
    const sub = audioContext.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(freq, time);
    const subGain = audioContext.createGain();
    subGain.gain.value = v.subGain;
    sub.connect(subGain);
    subGain.connect(filter);
    sub.start(time);
    sub.stop(time + ampDur + 0.05);

    // Bite layer (the edge), slightly detuned.
    const bite = audioContext.createOscillator();
    bite.type = v.biteWave;
    bite.frequency.setValueAtTime(freq, time);
    bite.detune.setValueAtTime(v.biteDetune, time);
    const biteGain = audioContext.createGain();
    biteGain.gain.value = v.biteGain;
    bite.connect(biteGain);
    biteGain.connect(filter);
    bite.start(time);
    bite.stop(time + ampDur + 0.05);

    // Optional octave-up layer (extra brightness / a slap harmonic).
    if (v.octaveBite && v.octaveBite > 0) {
      const oct = audioContext.createOscillator();
      oct.type = v.biteWave;
      oct.frequency.setValueAtTime(freq * 2, time);
      oct.detune.setValueAtTime(v.biteDetune, time);
      const octGain = audioContext.createGain();
      octGain.gain.value = v.octaveBite;
      oct.connect(octGain);
      octGain.connect(filter);
      oct.start(time);
      oct.stop(time + ampDur + 0.05);
    }

    // Optional attack transient (finger-pop / pluck noise). Bypasses the body
    // lowpass and rides its own quick envelope straight to the voice output so
    // it stays bright and percussive.
    if (v.transientGain && v.transientGain > 0 && noiseBuffer) {
      const noise = audioContext.createBufferSource();
      noise.buffer = noiseBuffer;
      const hp = audioContext.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = v.transientHpHz ?? 2000;
      const ng = audioContext.createGain();
      ng.gain.setValueAtTime(v.transientGain, time);
      ng.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
      noise.connect(hp);
      hp.connect(ng);
      ng.connect(voiceOut);
      noise.start(time);
      noise.stop(time + 0.05);
    }
  };

  const playChordStab = (midis: number[], time: number, duration: number) => {
    if (!audioContext || !chordBus) return;
    // Comp stab sits in a mid band (highpass above the bass, lowpass to tame
    // the saw fizz) so it cuts through the bass + drums. Routed to the chord bus
    // so the Chords volume slider controls it.
    const out = audioContext.createGain();
    out.gain.setValueAtTime(0.0001, time);
    out.gain.exponentialRampToValueAtTime(1, time + 0.012);
    out.gain.exponentialRampToValueAtTime(0.18, time + duration * 0.6);
    out.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    const highpass = audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 300;
    const lowpass = audioContext.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 3200;
    highpass.connect(lowpass);
    lowpass.connect(out);
    out.connect(chordBus);
    // Per-voice gain keeps the summed chord controlled; the master limiter
    // catches the peaks so the comp stays present without clipping.
    const perVoice = 0.22;
    midis.forEach((midi) => {
      const osc = audioContext!.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = midiToFrequency(midi);
      const voice = audioContext!.createGain();
      voice.gain.value = perVoice;
      osc.connect(voice);
      voice.connect(highpass);
      osc.start(time);
      osc.stop(time + duration + 0.02);
    });
  };

  // --- Scheduling --------------------------------------------------------

  // Drum pattern follows the bass style's feel: a driving straight rock beat,
  // a classic swung shuffle, or a spacious half-time two-feel.
  const scheduleDrums = (
    beatTime: number,
    beatInBar: number,
    feel: BassFeel,
    secondsPerBeat: number,
    offOffset: number
  ) => {
    if (feel === "half") {
      // Half-time two-feel: kick on 1, snare on 3, quarter-note hats.
      if (beatInBar === 0) playKick(beatTime);
      if (beatInBar === 2) playSnare(beatTime);
      playHiHat(beatTime, beatInBar === 0);
      return;
    }
    // Straight + shuffle share a backbeat; only the off-beat placement differs.
    if (beatInBar === 0 || beatInBar === 2) playKick(beatTime);
    // Straight feel adds a pushed kick on the "and" of 3 for extra drive.
    if (feel === "straight" && beatInBar === 2) {
      playKick(beatTime + secondsPerBeat * STRAIGHT);
    }
    if (beatInBar === 1 || beatInBar === 3) playSnare(beatTime);
    playHiHat(beatTime, beatInBar === 0);
    playHiHat(beatTime + offOffset, false);
  };

  const scheduleBeat = (beatTime: number, globalBeat: number) => {
    if (bars.length === 0) return;
    const totalBeats = bars.length * BEATS_PER_BAR;
    const loopBeat = ((globalBeat % totalBeats) + totalBeats) % totalBeats;
    const barIndex = Math.floor(loopBeat / BEATS_PER_BAR);
    const beatInBar = loopBeat % BEATS_PER_BAR;
    const bar = bars[barIndex];
    if (!bar) return;

    const feel = getBassStyle(bassStyleId).feel;
    const secondsPerBeat = 60 / tempo;
    const swing = feel === "shuffle" ? SHUFFLE : STRAIGHT;
    const offOffset = secondsPerBeat * swing;
    const onDur = offOffset * 0.92;
    const offDur = (secondsPerBeat - offOffset) * 0.92;

    scheduleDrums(beatTime, beatInBar, feel, secondsPerBeat, offOffset);

    // Bass: up to two eighths per beat from the active style's grid (skip rests).
    const onBeat = bar.bassLine[beatInBar * 2];
    const offBeat = bar.bassLine[beatInBar * 2 + 1];
    if (onBeat != null) {
      playBassNote(onBeat, beatTime, feel === "half" ? secondsPerBeat * 1.8 : onDur);
    }
    if (offBeat != null) {
      playBassNote(offBeat, beatTime + offOffset, offDur);
    }

    // Chords: comping stab on each beat when enabled.
    if (chordsEnabled) {
      playChordStab(bar.chordMidi, beatTime, secondsPerBeat * 0.6);
    }
  };

  const scheduler = () => {
    if (!audioContext) return;
    const secondsPerBeat = 60 / tempo;
    while (nextBeatTime < audioContext.currentTime + SCHEDULE_AHEAD) {
      scheduleBeat(nextBeatTime, nextBeatIndex);
      nextBeatIndex += 1;
      nextBeatTime += secondsPerBeat;
    }
  };

  // --- Visual loop (grid highlight + metronome dots) ---------------------

  const setHighlightedBar = (barIndex: number) => {
    if (barIndex === highlightedBar) return;
    highlightedBar = barIndex;
    cellEls.forEach((cell, index) => {
      cell.classList.toggle("is-active", index === barIndex);
    });
  };

  const setActiveDot = (dotIndex: number) => {
    if (dotIndex === activeDot) return;
    activeDot = dotIndex;
    dotEls.forEach((dot, index) => {
      dot.classList.toggle("is-active", index === dotIndex);
    });
  };

  const updateVisuals = () => {
    if (!isPlaying || !audioContext || bars.length === 0) return;
    const secondsPerBeat = 60 / tempo;
    const elapsed = Math.max(0, audioContext.currentTime - playbackStartTime);
    const globalBeat = elapsed / secondsPerBeat;
    const totalBeats = bars.length * BEATS_PER_BAR;
    const loopBeat = globalBeat % totalBeats;
    const barIndex = Math.floor(loopBeat / BEATS_PER_BAR);
    const barPhase = loopBeat - barIndex * BEATS_PER_BAR; // 0..4

    setHighlightedBar(barIndex);
    setActiveDot(Math.floor(barPhase) % BEATS_PER_BAR);

    // Each dot swells from half a beat before its beat to half a beat after.
    dotEls.forEach((dot, index) => {
      let distance = Math.abs(barPhase - index);
      distance = Math.min(distance, BEATS_PER_BAR - distance); // wrap the bar
      const intensity = distance < 0.5 ? 1 - distance / 0.5 : 0;
      dot.style.setProperty("--swell", intensity.toFixed(3));
    });

    rafId = requestAnimationFrame(updateVisuals);
  };

  const startVisualLoop = () => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(updateVisuals);
  };

  const stopVisualLoop = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    dotEls.forEach((dot) => dot.style.setProperty("--swell", "0"));
  };

  // --- Rendering ---------------------------------------------------------

  const rebuildBars = () => {
    bars = resolveProgression(progressionId, key, bassStyleId);
  };

  const renderGrid = () => {
    if (!gridEl) return;
    rebuildBars();
    gridEl.style.setProperty(
      "--blues-grid-rows",
      String(gridRowsForBarCount(bars.length))
    );
    gridEl.replaceChildren();
    cellEls = bars.map((bar, index) => {
      const cell = document.createElement("div");
      cell.className = "blues-grid-cell";
      const num = document.createElement("span");
      num.className = "blues-grid-num";
      num.textContent = String(index + 1);
      const label = document.createElement("span");
      label.className = "blues-grid-label";
      label.textContent = bar.label;
      cell.append(num, label);
      gridEl!.appendChild(cell);
      return cell as unknown as HTMLButtonElement;
    });
    highlightedBar = -1;
  };

  const renderMetronome = () => {
    if (!metronomeEl) return;
    metronomeEl.replaceChildren();
    dotEls = Array.from({ length: BEATS_PER_BAR }, () => {
      const dot = document.createElement("span");
      dot.className = "blues-beat-dot";
      dot.style.setProperty("--swell", "0");
      metronomeEl!.appendChild(dot);
      return dot;
    });
    activeDot = -1;
  };

  // --- Control sync ------------------------------------------------------

  const syncKeyButtons = () => {
    keyRowEl?.querySelectorAll<HTMLButtonElement>("[data-blues-key]").forEach(
      (button) => {
        const active = button.dataset.bluesKey === key;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-checked", String(active));
      }
    );
  };

  const syncTempo = () => {
    if (tempoInputEl) tempoInputEl.value = String(tempo);
    if (tempoValueEl) tempoValueEl.textContent = `${tempo} BPM`;
  };

  const syncProgression = () => {
    if (progressionSelectEl) progressionSelectEl.value = progressionId;
  };

  const syncBass = () => {
    if (bassSelectEl) bassSelectEl.value = bassStyleId;
  };

  const syncBassSound = () => {
    if (bassSoundSelectEl) bassSoundSelectEl.value = bassSoundId;
  };

  const syncChordsToggle = () => {
    if (chordsToggleEl) chordsToggleEl.checked = chordsEnabled;
    // The chord volume slider is only relevant when chords are enabled.
    chordVolControlEl?.toggleAttribute("hidden", !chordsEnabled);
  };

  const volumePercent = (value: number) => `${Math.round(value * 100)}%`;

  const syncVolumes = () => {
    if (bassVolInputEl) bassVolInputEl.value = String(Math.round(bassVolume * 100));
    if (bassVolValueEl) bassVolValueEl.textContent = volumePercent(bassVolume);
    if (chordVolInputEl) chordVolInputEl.value = String(Math.round(chordVolume * 100));
    if (chordVolValueEl) chordVolValueEl.textContent = volumePercent(chordVolume);
  };

  const setToggleLabel = () => {
    if (toggleButtonEl) toggleButtonEl.textContent = isPlaying ? "Stop" : "Play";
  };

  // --- Transport ---------------------------------------------------------

  const resetPhase = () => {
    if (!audioContext || !isPlaying) return;
    nextBeatIndex = 0;
    nextBeatTime = audioContext.currentTime + 0.06;
    playbackStartTime = nextBeatTime;
  };

  const startTransport = async () => {
    if (isPlaying) return;
    await ensureAudio();
    if (!audioContext) return;
    isPlaying = true;
    nextBeatIndex = 0;
    nextBeatTime = audioContext.currentTime + 0.1;
    playbackStartTime = nextBeatTime;
    scheduler();
    schedulerId = window.setInterval(scheduler, LOOKAHEAD_MS);
    startVisualLoop();
    setToggleLabel();
  };

  const stopTransport = () => {
    if (!isPlaying) return;
    isPlaying = false;
    if (schedulerId !== null) {
      window.clearInterval(schedulerId);
      schedulerId = null;
    }
    stopVisualLoop();
    setHighlightedBar(-1);
    setActiveDot(-1);
    setToggleLabel();
  };

  // --- Setters (rebuild + restart phase when playing) --------------------

  const setKey = (next: BluesKey) => {
    if (next === key) return;
    key = next;
    persist(KEY_STORAGE, key);
    syncKeyButtons();
    renderGrid();
    resetPhase();
  };

  const setTempo = (next: number) => {
    tempo = clamp(Math.round(next), TEMPO_MIN, TEMPO_MAX);
    persist(TEMPO_STORAGE, String(tempo));
    syncTempo();
  };

  const setProgression = (next: BluesProgressionId) => {
    if (next === progressionId) return;
    progressionId = next;
    persist(PROG_STORAGE, progressionId);
    renderGrid();
    resetPhase();
  };

  const setBassStyle = (next: BassStyleId) => {
    if (next === bassStyleId) return;
    bassStyleId = next;
    persist(BASS_STORAGE, bassStyleId);
    // Only the bass line changes — grid labels are unaffected.
    rebuildBars();
    resetPhase();
  };

  const setBassSound = (next: BassSoundId) => {
    if (next === bassSoundId) return;
    bassSoundId = next;
    persist(BASS_SOUND_STORAGE, bassSoundId);
    // Pure tone change — picked up by the next scheduled note, no rebuild.
  };

  const setChordsEnabled = (enabled: boolean) => {
    chordsEnabled = enabled;
    persist(CHORDS_STORAGE, enabled ? "1" : "0");
    syncChordsToggle();
  };

  const setBassVolume = (next: number) => {
    bassVolume = clamp(next, 0, 1);
    persist(BASS_VOL_STORAGE, bassVolume.toFixed(2));
    if (bassBus && audioContext) {
      bassBus.gain.setTargetAtTime(bassVolume, audioContext.currentTime, 0.01);
    }
    syncVolumes();
  };

  const setChordVolume = (next: number) => {
    chordVolume = clamp(next, 0, 1);
    persist(CHORD_VOL_STORAGE, chordVolume.toFixed(2));
    if (chordBus && audioContext) {
      chordBus.gain.setTargetAtTime(chordVolume, audioContext.currentTime, 0.01);
    }
    syncVolumes();
  };

  // --- UI wiring ---------------------------------------------------------

  const attachUi = () => {
    if (!screenEl) return;
    uiAbort?.abort();
    uiAbort = new AbortController();
    const { signal } = uiAbort;

    keyRowEl = screenEl.querySelector<HTMLElement>("[data-blues-key-row]");
    tempoInputEl = screenEl.querySelector<HTMLInputElement>("[data-blues-tempo]");
    tempoValueEl = screenEl.querySelector<HTMLElement>("[data-blues-tempo-value]");
    progressionSelectEl = screenEl.querySelector<HTMLSelectElement>(
      "[data-blues-progression]"
    );
    bassSelectEl = screenEl.querySelector<HTMLSelectElement>("[data-blues-bass]");
    bassSoundSelectEl = screenEl.querySelector<HTMLSelectElement>("[data-blues-bass-sound]");
    chordsToggleEl = screenEl.querySelector<HTMLInputElement>("[data-blues-chords]");
    bassVolInputEl = screenEl.querySelector<HTMLInputElement>("[data-blues-bass-vol]");
    bassVolValueEl = screenEl.querySelector<HTMLElement>("[data-blues-bass-vol-value]");
    chordVolInputEl = screenEl.querySelector<HTMLInputElement>("[data-blues-chord-vol]");
    chordVolValueEl = screenEl.querySelector<HTMLElement>("[data-blues-chord-vol-value]");
    chordVolControlEl = screenEl.querySelector<HTMLElement>("[data-blues-chord-vol-control]");
    toggleButtonEl = screenEl.querySelector<HTMLButtonElement>("[data-blues-toggle]");
    gridEl = screenEl.querySelector<HTMLElement>("[data-blues-grid]");
    metronomeEl = screenEl.querySelector<HTMLElement>("[data-blues-metronome]");

    keyRowEl?.addEventListener(
      "click",
      (event) => {
        const target = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
          "[data-blues-key]"
        );
        const value = target?.dataset.bluesKey;
        if (value) setKey(value as BluesKey);
      },
      { signal }
    );

    tempoInputEl?.addEventListener(
      "input",
      () => setTempo(Number(tempoInputEl?.value ?? tempo)),
      { signal }
    );

    progressionSelectEl?.addEventListener(
      "change",
      () => setProgression(progressionSelectEl?.value as BluesProgressionId),
      { signal }
    );

    bassSelectEl?.addEventListener(
      "change",
      () => setBassStyle(bassSelectEl?.value as BassStyleId),
      { signal }
    );

    bassSoundSelectEl?.addEventListener(
      "change",
      () => setBassSound(bassSoundSelectEl?.value as BassSoundId),
      { signal }
    );

    chordsToggleEl?.addEventListener(
      "change",
      () => setChordsEnabled(Boolean(chordsToggleEl?.checked)),
      { signal }
    );

    bassVolInputEl?.addEventListener(
      "input",
      () => setBassVolume(Number(bassVolInputEl?.value ?? 0) / 100),
      { signal }
    );

    chordVolInputEl?.addEventListener(
      "input",
      () => setChordVolume(Number(chordVolInputEl?.value ?? 0) / 100),
      { signal }
    );

    toggleButtonEl?.addEventListener(
      "click",
      () => {
        if (isPlaying) stopTransport();
        else void startTransport();
      },
      { signal }
    );
  };

  // --- Lifecycle ---------------------------------------------------------

  const enterMode = () => {
    readStored();
    attachUi();
    renderGrid();
    renderMetronome();
    syncKeyButtons();
    syncTempo();
    syncProgression();
    syncBass();
    syncBassSound();
    syncChordsToggle();
    syncVolumes();
    setToggleLabel();
  };

  const exitMode = () => {
    stopTransport();
    uiAbort?.abort();
    uiAbort = null;
    if (audioContext) {
      void audioContext.close();
      audioContext = null;
      masterGain = null;
      bassBus = null;
      chordBus = null;
      noiseBuffer = null;
    }
  };

  return {
    id: "blues-jam",
    title: "Blues Jam",
    preserveState: false,
    canFullscreen: false,
    onEnter: enterMode,
    onExit: exitMode,
  };
}
