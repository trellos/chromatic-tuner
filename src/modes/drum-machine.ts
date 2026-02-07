import type { ModeDefinition } from "./types.js";

export function createDrumMachineMode(): ModeDefinition {
  const drumModeEl = document.querySelector<HTMLElement>(
    '.mode-screen[data-mode="drum-machine"]'
  );
  const drumMockEl = drumModeEl?.querySelector<HTMLElement>(".drum-mock") ?? null;
  const drumGridsEl = drumMockEl?.querySelector<HTMLElement>(".drum-grids") ?? null;
  const playheadEl = drumMockEl?.querySelector<HTMLElement>(".drum-playhead") ?? null;
  const playButton = document.getElementById("drum-play-toggle");
  const beatButton = document.getElementById("drum-beat-button");
  const beatMenu = document.getElementById("drum-beat-menu");
  const tempoValueEl = document.getElementById("drum-tempo-value");
  const tempoButtons =
    drumMockEl?.querySelectorAll<HTMLButtonElement>("[data-tempo]") ?? [];

  const BPM_MIN = 60;
  const BPM_MAX = 180;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD = 0.1;
  const KICK_URL = "https://bigsoundbank.com/UPLOAD/bwf-en/2338.wav";
  const SNARE_URL = "https://bigsoundbank.com/UPLOAD/bwf-en/2304.wav";
  const HAT_URL = "https://bigsoundbank.com/UPLOAD/bwf-en/2290.wav";

  let signature = "4/4";
  let bpm = 120;
  let isPlaying = false;
  let audioContext: AudioContext | null = null;
  let buffers: Record<string, AudioBuffer | null> = {
    kick: null,
    snare: null,
    hat: null,
    perc: null,
  };
  let schedulerId: number | null = null;
  let nextStepTime = 0;
  let currentStep = 0;
  let lastStepIndex: number | null = null;
  let uiAbort: AbortController | null = null;
  let playheadTimeouts: number[] = [];

  const getStepsPerBar = () => (signature === "4/4" ? 16 : 12);

  const getBeatsPerBar = () =>
    Number.parseInt(signature.split("/")[0] ?? "4", 10);

  const setSignature = (value: string) => {
    signature = value;
    if (drumMockEl) {
      drumMockEl.dataset.signature = value;
    }
    if (drumGridsEl) {
      const count = value === "4/4" ? 16 : 12;
      drumGridsEl.style.setProperty("--playhead-count", String(count));
      drumGridsEl.style.setProperty("--playhead-index", "0");
    }
    drumMockEl?.querySelectorAll(".step.is-current").forEach((step) => {
      step.classList.remove("is-current");
    });
    playheadEl?.classList.remove("is-active");
    lastStepIndex = null;
    currentStep = 0;
    if (audioContext) {
      nextStepTime = audioContext.currentTime + 0.05;
    }
  };

  const clearRow = (row: HTMLElement) => {
    row.querySelectorAll<HTMLButtonElement>(".step").forEach((step) => {
      step.classList.remove("is-on");
    });
  };

  const setStep = (row: HTMLElement, index: number, on: boolean) => {
    const steps = row.querySelectorAll<HTMLButtonElement>(".step");
    const step = steps[index];
    if (!step) return;
    step.classList.toggle("is-on", on);
  };

  const applyBeat = (beat: string) => {
    setSignature("4/4");
    const grid = drumMockEl?.querySelector<HTMLElement>(
      '.drum-grid[data-signature="4/4"]'
    );
    if (!grid) return;

    const rows = grid.querySelectorAll<HTMLElement>(".drum-row");
    rows.forEach(clearRow);

    const kick = rows[0];
    const snare = rows[1];
    const hat = rows[2];
    const perc = rows[3];

    const setHatEights = () => {
      if (!hat) return;
      for (let i = 0; i < 16; i += 2) setStep(hat, i, true);
    };

    const setHatSixteenths = (swing = false) => {
      if (!hat) return;
      for (let i = 0; i < 16; i++) {
        const on = swing ? i % 2 === 0 || (i % 4 === 3 && Math.random() < 0.6) : true;
        if (on) setStep(hat, i, true);
      }
    };

    const setBackbeat = () => {
      if (!snare) return;
      setStep(snare, 4, true);
      setStep(snare, 12, true);
    };

    const setFourOnFloor = () => {
      if (!kick) return;
      [0, 4, 8, 12].forEach((i) => setStep(kick, i, true));
    };

    const setRockKick = () => {
      if (!kick) return;
      setStep(kick, 0, true);
      setStep(kick, 8, true);
      setStep(kick, 6, Math.random() < 0.4);
      setStep(kick, 10, Math.random() < 0.4);
    };

    const setShuffleKick = () => {
      if (!kick) return;
      setStep(kick, 0, true);
      setStep(kick, 6, true);
      setStep(kick, 12, true);
      setStep(kick, 14, Math.random() < 0.5);
    };

    const setBreakKick = () => {
      if (!kick) return;
      [0, 6, 7, 10, 12].forEach((i) => setStep(kick, i, true));
    };

    const setPercOffbeats = (prob: number) => {
      if (!perc) return;
      for (let i = 0; i < 16; i++) {
        if (i % 4 === 2 && Math.random() < prob) setStep(perc, i, true);
      }
    };

    switch (beat) {
      case "rock":
        setRockKick();
        setBackbeat();
        setHatEights();
        setPercOffbeats(0.3);
        break;
      case "shuffle":
        setShuffleKick();
        setBackbeat();
        setHatSixteenths(true);
        setPercOffbeats(0.2);
        break;
      case "disco":
        setFourOnFloor();
        setBackbeat();
        setHatSixteenths();
        break;
      case "half-time":
        if (kick) {
          setStep(kick, 0, true);
          setStep(kick, 8, Math.random() < 0.6);
          setStep(kick, 12, Math.random() < 0.4);
        }
        if (snare) {
          setStep(snare, 8, true);
        }
        if (hat) {
          for (let i = 0; i < 16; i++) {
            const on = i % 4 === 0 || (i % 8 === 6 && Math.random() < 0.6);
            if (on) setStep(hat, i, true);
          }
        }
        break;
      case "breakbeat":
        setBreakKick();
        if (snare) {
          setStep(snare, 4, true);
          setStep(snare, 12, true);
          setStep(snare, 14, true);
        }
        if (hat) {
          for (let i = 0; i < 16; i++) {
            const on = i % 2 === 0 || (i % 4 === 3 && Math.random() < 0.5);
            if (on) setStep(hat, i, true);
          }
        }
        setPercOffbeats(0.35);
        break;
      case "afrobeat":
        if (kick) {
          [0, 5, 8, 11, 15].forEach((i) => setStep(kick, i, true));
        }
        if (snare) {
          [4, 12].forEach((i) => setStep(snare, i, true));
          setStep(snare, 10, true);
        }
        if (hat) {
          for (let i = 0; i < 16; i++) {
            const on = i % 4 === 0 || i % 4 === 2;
            if (on || Math.random() < 0.2) setStep(hat, i, true);
          }
        }
        setPercOffbeats(0.4);
        break;
      case "minimal":
        if (kick) {
          setStep(kick, 0, true);
          setStep(kick, 8, true);
        }
        if (snare) {
          setStep(snare, 12, true);
        }
        if (hat) {
          for (let i = 0; i < 16; i++) {
            if (i % 4 === 2) setStep(hat, i, true);
          }
        }
        break;
      default:
        setRockKick();
        setBackbeat();
        setHatEights();
        break;
    }
  };

  const setBpm = (value: number) => {
    bpm = Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(value)));
    if (tempoValueEl) tempoValueEl.textContent = String(bpm);
  };

  const ensureAudio = async () => {
    if (audioContext) {
      await audioContext.resume();
      return;
    }

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    audioContext = new AudioCtx({ latencyHint: "interactive" });
    await audioContext.resume();

    const loadSample = async (url: string) => {
      try {
        const response = await fetch(url);
        const data = await response.arrayBuffer();
        return await audioContext!.decodeAudioData(data);
      } catch {
        return null;
      }
    };

    const [kick, snare, hat] = await Promise.all([
      loadSample(KICK_URL),
      loadSample(SNARE_URL),
      loadSample(HAT_URL),
    ]);

    buffers = {
      kick,
      snare,
      hat,
      perc: snare ?? hat,
    };
  };

  const playBuffer = (
    buffer: AudioBuffer | null,
    time: number,
    gainValue: number
  ) => {
    if (!audioContext || !buffer) return;
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    const gain = audioContext.createGain();
    gain.gain.value = gainValue;
    source.connect(gain);
    gain.connect(audioContext.destination);
    source.start(time);
  };

  const playVoice = (voice: string, time: number) => {
    if (buffers[voice]) {
      const gainValue =
        voice === "kick" ? 1.0 : voice === "snare" ? 0.85 : 0.5;
      playBuffer(buffers[voice], time, gainValue);
      return;
    }

    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = "triangle";
    if (voice === "kick") osc.frequency.value = 120;
    if (voice === "snare") osc.frequency.value = 240;
    if (voice === "hat") osc.frequency.value = 520;
    if (voice === "perc") osc.frequency.value = 320;
    gain.gain.value = 0.18;
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  };

  const schedule = () => {
    if (!audioContext) return;
    const stepsPerBar = getStepsPerBar();
    const beatsPerBar = getBeatsPerBar();
    const stepsPerBeat = stepsPerBar / beatsPerBar;
    const stepDuration = (60 / bpm) / stepsPerBeat;
    while (nextStepTime < audioContext.currentTime + SCHEDULE_AHEAD) {
      const activeGrid = drumMockEl?.querySelector<HTMLElement>(
        `.drum-grid[data-signature="${signature}"]`
      );
      const stepToHighlight = currentStep;
      if (activeGrid) {
        const delay = Math.max(
          0,
          (nextStepTime - audioContext.currentTime) * 1000
        );
        const timeout = window.setTimeout(() => {
          const rows = activeGrid.querySelectorAll<HTMLElement>(".drum-row");
          if (lastStepIndex !== null) {
            rows.forEach((row) => {
              const steps = row.querySelectorAll<HTMLButtonElement>(".step");
              steps[lastStepIndex]?.classList.remove("is-current");
            });
          }
          rows.forEach((row) => {
            const steps = row.querySelectorAll<HTMLButtonElement>(".step");
            steps[stepToHighlight]?.classList.add("is-current");
          });
          if (drumGridsEl) {
            drumGridsEl.style.setProperty(
              "--playhead-index",
              String(stepToHighlight)
            );
          }
          playheadEl?.classList.add("is-active");
          lastStepIndex = stepToHighlight;
        }, delay);
        playheadTimeouts.push(timeout);
      }
      if (activeGrid) {
        const rows = activeGrid.querySelectorAll<HTMLElement>(".drum-row");
        rows.forEach((row) => {
          const voice = row.dataset.voice ?? "perc";
          const steps = row.querySelectorAll<HTMLButtonElement>(".step");
          const stepEl = steps[currentStep];
          if (stepEl?.classList.contains("is-on")) {
            playVoice(voice, nextStepTime);
          }
        });
      }
      currentStep = (currentStep + 1) % stepsPerBar;
      nextStepTime += stepDuration;
    }
  };

  const start = async () => {
    if (isPlaying) return;
    await ensureAudio();
    if (!audioContext) return;
    isPlaying = true;
    currentStep = 0;
    nextStepTime = audioContext.currentTime + 0.05;
    schedulerId = window.setInterval(schedule, LOOKAHEAD_MS);
    if (playButton) playButton.textContent = "Stop";
  };

  const stop = () => {
    if (!isPlaying) return;
    isPlaying = false;
    if (schedulerId !== null) {
      window.clearInterval(schedulerId);
      schedulerId = null;
    }
    playheadTimeouts.forEach((id) => window.clearTimeout(id));
    playheadTimeouts = [];
    if (lastStepIndex !== null) {
      const activeGrid = drumMockEl?.querySelector<HTMLElement>(
        `.drum-grid[data-signature="${signature}"]`
      );
      const rows = activeGrid?.querySelectorAll<HTMLElement>(".drum-row");
      rows?.forEach((row) => {
        const steps = row.querySelectorAll<HTMLButtonElement>(".step");
        steps[lastStepIndex]?.classList.remove("is-current");
      });
      lastStepIndex = null;
    }
    playheadEl?.classList.remove("is-active");
    if (playButton) playButton.textContent = "Play";
  };

  const attachUi = () => {
    if (!drumMockEl) return;
    uiAbort?.abort();
    uiAbort = new AbortController();
    const { signal } = uiAbort;

    tempoButtons.forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const direction = button.dataset.tempo;
          if (direction === "down") setBpm(bpm - 1);
          if (direction === "up") setBpm(bpm + 1);
        },
        { signal }
      );
    });

    drumMockEl.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        if (!target?.classList.contains("step")) return;
        target.classList.toggle("is-on");
      },
      { signal }
    );

    if (playButton) {
      playButton.addEventListener(
        "click",
        () => {
          if (isPlaying) stop();
          else void start();
        },
        { signal }
      );
    }

    if (beatButton && beatMenu) {
      const toggleBeatMenu = (open: boolean) => {
        beatMenu.classList.toggle("is-open", open);
        beatButton.setAttribute("aria-expanded", String(open));
      };

      beatButton.addEventListener(
        "click",
        (event) => {
          event.stopPropagation();
          const isOpen = beatMenu.classList.contains("is-open");
          toggleBeatMenu(!isOpen);
        },
        { signal }
      );

      beatMenu.addEventListener(
        "click",
        (event) => {
          const target = event.target as HTMLElement | null;
          const beat = target?.getAttribute("data-beat");
          if (!beat) return;
          applyBeat(beat);
          toggleBeatMenu(false);
        },
        { signal }
      );

      document.addEventListener(
        "click",
        (event) => {
          if (beatMenu.contains(event.target as Node)) return;
          if (beatButton.contains(event.target as Node)) return;
          toggleBeatMenu(false);
        },
        { signal }
      );
    }

  };

  const enter = async () => {
    setSignature(signature);
    setBpm(bpm);
    attachUi();
  };

  const exit = () => {
    stop();
    uiAbort?.abort();
    uiAbort = null;
  };

  return {
    id: "drum-machine",
    title: "Drum Machine",
    icon: "DR",
    preserveState: true,
    canFullscreen: true,
    onEnter: enter,
    onExit: exit,
  };
}
