import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentHeartbeatRepository } from '@tasktwin/database';

import { ComponentHeartbeatReporter } from './component-heartbeat.reporter.js';

describe('ComponentHeartbeatReporter', () => {
  afterEach(() => vi.useRealTimers());

  it('registers, refreshes and gracefully stops without audit behavior', async () => {
    vi.useFakeTimers();
    const repository = {
      register: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(true),
      stop: vi.fn().mockResolvedValue(true),
    };
    const reporter = new ComponentHeartbeatReporter(
      repository as unknown as ComponentHeartbeatRepository,
      'control_plane_api',
    );
    await reporter.start();
    expect(repository.register).toHaveBeenCalledWith({
      processInstanceId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      componentType: 'control_plane_api',
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(repository.refresh).toHaveBeenCalledOnce();
    await reporter.stop();
    expect(repository.stop).toHaveBeenCalledOnce();
  });

  it('uses only a safe code when persistence fails', async () => {
    const repository = {
      register: vi
        .fn()
        .mockRejectedValue(new Error('postgres://secret-host/private')),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reporter = new ComponentHeartbeatReporter(
      repository as unknown as ComponentHeartbeatRepository,
      'scheduler',
    );
    await reporter.start();
    await reporter.stop();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-host');
    warn.mockRestore();
  });
});
