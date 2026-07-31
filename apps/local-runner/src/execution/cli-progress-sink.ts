import type {
  WorkflowProgressEvent,
  WorkflowProgressSink,
} from '@tasktwin/workflow-engine';

import type { RunnerOutput } from '../runner-service.js';

export class CliProgressSink implements WorkflowProgressSink {
  constructor(private readonly output: RunnerOutput) {}

  emit(event: WorkflowProgressEvent): void {
    switch (event.kind) {
      case 'run_status_changed':
        this.output.write(`Execution status: ${event.status}`);
        return;
      case 'step_status_changed':
        this.output.write(
          `Step ${event.stepId} (${event.stepType}): ${event.status}`,
        );
        return;
      case 'warning':
        this.output.write(`Execution warning: ${event.warningCode}`);
    }
  }
}
