export type LooperRecorder = {
  recordPulse: (midis: number[], durationMs: number) => void;
  recordHoldStart: (sourceId: string, midis: number[]) => void;
  recordHoldEnd: (sourceId: string) => void;
};

export type LooperRecordable = {
  setLooperRecorder: (recorder: LooperRecorder | null) => void;
};
