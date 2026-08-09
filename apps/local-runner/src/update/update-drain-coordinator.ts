import type {
  RunnerActivationId,
  RunnerUpdateId,
} from '@tasktwin/runner-update';

import { FileRunnerStartupStatusStore } from '../runtime/startup-status-store.js';
import type { RunnerUpdateDrainCoordinator } from './update-controller.js';

export class FileRunnerUpdateDrainCoordinator implements RunnerUpdateDrainCoordinator {
  constructor(private readonly status: FileRunnerStartupStatusStore) {}

  async waitForDrain(input: {
    readonly activationId: RunnerActivationId;
    readonly updateId: RunnerUpdateId;
    readonly timeoutMilliseconds: number;
    readonly requireInitiallyIdle: boolean;
  }): Promise<'drained' | 'active' | 'timeout'> {
    void input.updateId;
    const deadline = Date.now() + input.timeoutMilliseconds;
    for (;;) {
      const status = await this.status.read();
      if (
        status !== null &&
        status.activationId === input.activationId &&
        status.state === 'draining' &&
        !status.acceptsNewJobs
      ) {
        if (input.requireInitiallyIdle && status.activeWork) return 'active';
        if (!status.activeWork) return 'drained';
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return 'timeout';
      await delay(Math.min(250, remaining));
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}
