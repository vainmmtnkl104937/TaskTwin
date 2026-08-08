import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentHeartbeatRepository } from '@tasktwin/database';

import { WorkerComponentHeartbeat } from '../src/component-heartbeat.js';

describe('WorkerComponentHeartbeat', () => {
  afterEach(() => vi.useRealTimers());

  it('refreshes and marks a notification worker stopped', async () => {
    vi.useFakeTimers();
    const repository = {
      register: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(true),
      stop: vi.fn().mockResolvedValue(true),
    };
    const heartbeat = new WorkerComponentHeartbeat(
      repository as unknown as ComponentHeartbeatRepository,
      '00000000-0000-4000-8000-000000000028',
      'notification_worker',
    );
    await heartbeat.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await heartbeat.stop();
    expect(repository.register).toHaveBeenCalledOnce();
    expect(repository.refresh).toHaveBeenCalledOnce();
    expect(repository.stop).toHaveBeenCalledOnce();
  });
});
