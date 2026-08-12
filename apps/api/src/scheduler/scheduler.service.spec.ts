import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ComponentHeartbeatRepository,
  WorkflowScheduleRepository,
} from '@tasktwin/database';

import { SchedulerService } from './scheduler.service.js';

describe('SchedulerService lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports heartbeat and waits for its current tick before graceful stop', async () => {
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

  it('bounds parallel schedule dispatch to ten operations', async () => {
    let active = 0;
    let maximum = 0;
    const schedules = {
      selectDueSchedules: vi.fn().mockResolvedValue(
        Array.from({ length: 25 }, (_, index) => ({
          scheduleId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          workspaceId: '00000000-0000-4000-8000-000000000001',
          nextOccurrenceAt: new Date(),
        })),
      ),
      processOccurrence: vi.fn(async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active -= 1;
        return null;
      }),
    };
    const heartbeat = {
      register: vi.fn(),
      refresh: vi.fn(),
      stop: vi.fn(),
    };
    const service = new SchedulerService(
      schedules as unknown as WorkflowScheduleRepository,
      heartbeat as unknown as ComponentHeartbeatRepository,
    );
    await (
      service as unknown as {
        processDueSchedules(now: Date): Promise<void>;
      }
    ).processDueSchedules(new Date());
    expect(maximum).toBe(10);
    expect(schedules.processOccurrence).toHaveBeenCalledTimes(25);
  });
});
