import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ComponentHeartbeatRepository,
  WorkflowScheduleRepository,
} from '@tasktwin/database';

import { SchedulerService } from './scheduler.service.js';

describe('SchedulerService lifecycle', () => {
  const originalEnvironment = { ...process.env };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnvironment };
  });

  it('reports heartbeat and waits for its current tick before graceful stop', async () => {
    process.env.SCHEDULER_ENABLED = 'true';
    let finishTick: (() => void) | undefined;
    const terminal = new Promise<void>((resolve) => {
      finishTick = resolve;
    });
    const schedules = {
      selectDueSchedules: vi.fn().mockResolvedValue([]),
      reconcileTimedOutOccurrences: vi.fn().mockResolvedValue(0),
      reconcileTerminalOccurrences: vi
        .fn()
        .mockReturnValue(terminal.then(() => 0)),
    };
    const heartbeat = {
      register: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(true),
      stop: vi.fn().mockResolvedValue(true),
    };
    const service = new SchedulerService(
      schedules as unknown as WorkflowScheduleRepository,
      heartbeat as unknown as ComponentHeartbeatRepository,
    );
    await service.onModuleInit();
    const stopping = service.onModuleDestroy();
    expect(heartbeat.stop).not.toHaveBeenCalled();
    finishTick?.();
    await stopping;
    expect(heartbeat.register).toHaveBeenCalledOnce();
    expect(heartbeat.stop).toHaveBeenCalledOnce();
  });
});
