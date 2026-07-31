import {
  WorkflowProgressEventSchema,
  type WorkflowEngineWarning,
  type WorkflowProgressEvent,
} from './contracts.js';

export interface WorkflowProgressSink {
  emit(event: WorkflowProgressEvent): void;
}

const PROGRESS_WARNING: WorkflowEngineWarning = {
  code: 'PROGRESS_SINK_FAILED',
  message: 'Workflow progress reporting stopped safely.',
};

export class SafeProgressEmitter {
  private enabled = true;
  private failed = false;

  constructor(private readonly sink?: WorkflowProgressSink) {}

  emit(event: WorkflowProgressEvent): void {
    if (!this.enabled || this.sink === undefined) {
      return;
    }
    try {
      this.sink.emit(WorkflowProgressEventSchema.parse(event));
    } catch {
      this.enabled = false;
      this.failed = true;
    }
  }

  warnings(): readonly WorkflowEngineWarning[] {
    return this.failed ? [PROGRESS_WARNING] : [];
  }
}
