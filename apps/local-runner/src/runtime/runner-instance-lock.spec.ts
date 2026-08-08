import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RunnerServiceRuntimeError } from '@tasktwin/runner-service-runtime';
import { afterEach, describe, expect, it } from 'vitest';

import { FileRunnerInstanceLock } from './runner-instance-lock.js';

const RUNNER_A = '753ff8fc-4267-4d99-b741-41485f5bab45';
const RUNNER_B = 'ad8ca9d9-648e-47c5-8443-408a1308315d';
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tasktwin-instance-lock-'));
  directories.push(directory);
  return directory;
}

describe('FileRunnerInstanceLock', () => {
  it('rejects a second process for one Runner identity and permits another identity', async () => {
    const root = await temporaryRoot();
    const locks = new FileRunnerInstanceLock(root, {
      staleMilliseconds: 2_000,
      updateMilliseconds: 500,
      retries: 0,
      retryMilliseconds: 1,
    });
    const first = await locks.acquire(RUNNER_A);
    await expect(locks.acquire(RUNNER_A)).rejects.toEqual(
      new RunnerServiceRuntimeError('RUNNER_INSTANCE_ALREADY_ACTIVE'),
    );
    const independent = await locks.acquire(RUNNER_B);
    await independent.release();
    await first.release();
    const reacquired = await locks.acquire(RUNNER_A);
    await reacquired.release();
  });

  it('recovers a stale filesystem owner left by a crashed process', async () => {
    const root = await temporaryRoot();
    const target = join(root, '.tasktwin', 'runner-instances', RUNNER_A);
    const staleLock = `${target}.lock`;
    await mkdir(staleLock, { recursive: true });
    const old = new Date(Date.now() - 60_000);
    await utimes(staleLock, old, old);
    const locks = new FileRunnerInstanceLock(root, {
      staleMilliseconds: 2_000,
      updateMilliseconds: 500,
      retries: 0,
      retryMilliseconds: 1,
    });
    const recovered = await locks.acquire(RUNNER_A);
    await recovered.release();
  });
});
