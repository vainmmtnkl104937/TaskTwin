export interface WorkflowEngineTimer {
  cancel(): void;
}

export interface WorkflowEngineClock {
  nowMs(): number;
  schedule(callback: () => void, delayMs: number): WorkflowEngineTimer;
}

export const systemWorkflowEngineClock: WorkflowEngineClock = {
  nowMs: () => Date.now(),
  schedule: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    return {
      cancel: () => clearTimeout(handle),
    };
  },
};

export function timestampFromMs(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}
