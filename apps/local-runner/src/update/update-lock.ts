import { dirname } from 'node:path';

import lockfile from 'proper-lockfile';

import {
  assertControlledDirectoryChain,
  ensureControlledDirectory,
} from './controlled-directory.js';
import type { RunnerInstallationSecurityBoundary } from '../platform/windows/windows-runner-installation-acl.js';

export interface RunnerUpdateLease {
  release(): Promise<void>;
}

export class FileRunnerUpdateLock {
  constructor(
    private readonly lockPath: string,
    private readonly timing: {
      staleMilliseconds: number;
      updateMilliseconds: number;
      retries: number;
      retryMilliseconds: number;
    } = {
      staleMilliseconds: 120_000,
      updateMilliseconds: 10_000,
      retries: 0,
      retryMilliseconds: 50,
    },
    private readonly securityBoundary?: RunnerInstallationSecurityBoundary,
  ) {}

  async acquire(): Promise<RunnerUpdateLease> {
    await ensureControlledDirectory(dirname(this.lockPath));
    await ensureControlledDirectory(this.lockPath);
    await this.securityBoundary?.protectAndValidate();
    let release: (() => Promise<void>) | null = null;
    try {
      release = await lockfile.lock(this.lockPath, {
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
    } catch {
      throw new Error('Another local Runner update is already in progress.');
    }
    try {
      await assertControlledDirectoryChain(this.lockPath);
      await this.securityBoundary?.protectAndValidate();
      let active = true;
      return {
        release: async () => {
          if (!active) return;
          active = false;
          await release?.().catch(() => undefined);
        },
      };
    } catch (error: unknown) {
      await release().catch(() => undefined);
      throw error;
    }
  }
}
