export type ModeId =
  | "tuner"
  | "metronome"
  | "fretboard"
  | "key-finder"
  | "circle-of-fifths"
  | "drum-machine"
  | "extra-jimmy"
  | "wild-tuna";

// A mode is the high-level object that encapsulates one app screen's
// identity, capabilities, and lifecycle behavior (enter/exit callbacks).
export type ModeDefinition = {
  // Identity and display metadata used by mode selectors and labels.
  id: ModeId;
  title: string;

  // Capability flags that affect container behavior.
  preserveState?: boolean;
  canFullscreen?: boolean;

  // Lifecycle callbacks run by main mode flow:
  // current.onExit() -> UI state swap -> next.onEnter().
  onEnter?: () => void | Promise<void>;
  onExit?: () => void | Promise<void>;
};
