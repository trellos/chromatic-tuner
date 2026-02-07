export type ModeId = "tuner" | "metronome" | "drum-machine";

export type ModeDefinition = {
  id: ModeId;
  title: string;
  icon: string;
  preserveState?: boolean;
  canFullscreen?: boolean;
  onEnter?: () => void | Promise<void>;
  onExit?: () => void | Promise<void>;
};
