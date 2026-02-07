import type { ModeDefinition } from "./types.js";

export function createDrumMachineMode(): ModeDefinition {
  const drumModeEl = document.querySelector<HTMLElement>(
    '.mode-screen[data-mode="drum-machine"]'
  );
  const drumMockEl = drumModeEl?.querySelector<HTMLElement>(".drum-mock") ?? null;
  const signatureInputs =
    drumMockEl?.querySelectorAll<HTMLInputElement>('input[name="time-signature"]') ??
    [];
  const playButton = document.getElementById("drum-play-toggle");
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
    drumMockEl?.querySelectorAll(".step.is-current").forEach((step) => {
      step.classList.remove("is-current");
    });
    lastStepIndex = null;
    currentStep = 0;
    if (audioContext) {
      nextStepTime = audioContext.currentTime + 0.05;
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
          const steps = activeGrid.querySelectorAll<HTMLButtonElement>(".step");
          if (lastStepIndex !== null && steps[lastStepIndex]) {
            steps[lastStepIndex]?.classList.remove("is-current");
          }
          steps[stepToHighlight]?.classList.add("is-current");
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
      const steps = activeGrid?.querySelectorAll<HTMLButtonElement>(".step");
      steps?.[lastStepIndex]?.classList.remove("is-current");
      lastStepIndex = null;
    }
    if (playButton) playButton.textContent = "Play";
  };

  const attachUi = () => {
    if (!drumMockEl) return;
    uiAbort?.abort();
    uiAbort = new AbortController();
    const { signal } = uiAbort;

    signatureInputs.forEach((input) => {
      input.addEventListener(
        "change",
        () => {
          if (input.checked) {
            const value =
              input.id === "ts-3-4" ? "3/4" : input.id === "ts-6-8" ? "6/8" : "4/4";
            setSignature(value);
          }
        },
        { signal }
      );
    });

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

  };

  const enter = async () => {
    const activeInput =
      Array.from(signatureInputs).find((input) => input.checked) ??
      signatureInputs[0];
    if (activeInput) {
      const value =
        activeInput.id === "ts-3-4"
          ? "3/4"
          : activeInput.id === "ts-6-8"
            ? "6/8"
            : "4/4";
      setSignature(value);
    }
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
