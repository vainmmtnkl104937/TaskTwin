import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { RunnerServiceRuntimeError } from '@tasktwin/runner-service-runtime';
import lockfile from 'proper-lockfile';

export interface RunnerInstanceLease {
  readonly runnerDeviceId: string;
  release(): Promise<void>;
}

export class FileRunnerInstanceLock {
  constructor(
    private readonly rootDirectory: string,
    private readonly timing: {
      staleMilliseconds: number;
      updateMilliseconds: number;
      retries: number;
      retryMilliseconds: number;
    } = {
      staleMilliseconds: 120_000,
      updateMilliseconds: 10_000,
      retries: 10,
      retryMilliseconds: 50,
    },
  ) {}

  async acquire(runnerDeviceId: string): Promise<RunnerInstanceLease> {
    if (!/^[0-9a-f-]{36}$/i.test(runnerDeviceId)) {
      throw new RunnerServiceRuntimeError('RUNNER_SERVICE_CONFIGURATION_INVALID');
    }
    const lockRoot = join(this.rootDirectory, '.tasktwin', 'runner-instances');
    const target = join(lockRoot, runnerDeviceId);
    try {
      await mkdir(target, { recursive: true, mode: 0o700 });
      await chmod(lockRoot, 0o700).catch(() => undefined);
      await chmod(target, 0o700).catch(() => undefined);
      const release = await lockfile.lock(target, {
        realpath: false,
        stale: this.timing.staleMilliseconds,
        update: this.timing.updateMilliseconds,
        retries: {
          retries: this.timing.retries,
          factor: 1,
          minTimeout: this.timing.retryMilliseconds,
          maxTimeout: this.timing.retryMilliseconds,
        },
      });
      let active = true;
      return {
        runnerDeviceId,
        release: async () => {
          if (!active) return;
          active = false;
          await release().catch(() => undefined);
        },
      };
    } catch {
      throw new RunnerServiceRuntimeError('RUNNER_INSTANCE_ALREADY_ACTIVE');
    }
  }
}
