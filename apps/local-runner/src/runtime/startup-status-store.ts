import { isAbsolute, resolve } from 'node:path';

import {
  RunnerStartupStatusSchema,
  type RunnerStartupStatus,
} from '@tasktwin/runner-update';

import { AtomicJsonStore } from '../update/atomic-json-store.js';

const DEFAULT_STATUS_WAIT_TIMEOUT_MS = 3 * 60_000;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 250;
const MAX_STATUS_WAIT_TIMEOUT_MS = 10 * 60_000;
const MAX_STARTUP_STATUS_BYTES = 32 * 1024;

export interface RunnerStartupStatusWriter {
  write(status: RunnerStartupStatus): Promise<void>;
}

export class FileRunnerStartupStatusStore implements RunnerStartupStatusWriter {
  readonly path: string;
  private readonly record: AtomicJsonStore<RunnerStartupStatus>;

  constructor(path: string) {
    if (!isAbsolute(path) || path.includes('\0')) {
      throw new Error('The Runner startup-status path is invalid.');
    }
    this.path = resolve(path);
    this.record = new AtomicJsonStore(
      this.path,
      RunnerStartupStatusSchema,
      MAX_STARTUP_STATUS_BYTES,
    );
  }

  read(): Promise<RunnerStartupStatus | null> {
    return this.record.read();
  }

  write(status: RunnerStartupStatus): Promise<void> {
    return this.record.replace(RunnerStartupStatusSchema.parse(status));
  }

  async waitForStatus(input: {
    readonly matches: (status: RunnerStartupStatus) => boolean;
    readonly signal?: AbortSignal;
    readonly timeoutMilliseconds?: number;
    readonly pollIntervalMilliseconds?: number;
  }): Promise<RunnerStartupStatus> {
    const timeoutMilliseconds =
      input.timeoutMilliseconds ?? DEFAULT_STATUS_WAIT_TIMEOUT_MS;
    const pollIntervalMilliseconds =
      input.pollIntervalMilliseconds ?? DEFAULT_STATUS_POLL_INTERVAL_MS;
    if (
      !Number.isInteger(timeoutMilliseconds) ||
      timeoutMilliseconds < 1 ||
      timeoutMilliseconds > MAX_STATUS_WAIT_TIMEOUT_MS ||
      !Number.isInteger(pollIntervalMilliseconds) ||
      pollIntervalMilliseconds < 1 ||
      pollIntervalMilliseconds > 5_000
    ) {
      throw new Error('The Runner startup-status wait is invalid.');
    }
    const deadline = Date.now() + timeoutMilliseconds;
    for (;;) {
      if (input.signal?.aborted === true) {
        throw new Error('The Runner startup-status wait was aborted.');
      }
      const status = await this.read();
      if (status !== null && input.matches(status)) return status;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error('The Runner startup-status wait timed out.');
      }
      await abortableDelay(
        Math.min(pollIntervalMilliseconds, remaining),
        input.signal,
      );
    }
  }
}

function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted === true) {
    return Promise.reject(
      new Error('The Runner startup-status wait was aborted.'),
    );
  }
  return new Promise<void>((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolvePromise();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(new Error('The Runner startup-status wait was aborted.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
