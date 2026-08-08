import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../src/index.js';

import { ComponentHeartbeatRepository } from '../src/operational-telemetry/component-heartbeat.repository.js';

describe('ComponentHeartbeatRepository', () => {
  it('uses database time to register, refresh and stop a safe boot record', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const repository = new ComponentHeartbeatRepository({
      $executeRaw: executeRaw,
    } as unknown as PrismaClient);
    const processInstanceId = '00000000-0000-4000-8000-000000000028';
    await repository.register({
      processInstanceId,
      componentType: 'scheduler',
    });
    await expect(repository.refresh(processInstanceId)).resolves.toBe(true);
    await expect(repository.stop(processInstanceId)).resolves.toBe(true);

    const sql = executeRaw.mock.calls
      .map((call) => (call[0] as TemplateStringsArray).join('?'))
      .join('\n');
    expect(sql).toContain('clock_timestamp()');
    expect(sql).toContain('graceful_stopped_at');
    expect(sql).not.toMatch(
      /hostname|ip_address|os_username|environment|credential/i,
    );
  });

  it('returns health samples without process-instance identity', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        componentType: 'notification_worker',
        startedAt: new Date('2026-08-08T12:00:00.000Z'),
        latestHeartbeatAt: new Date('2026-08-08T12:00:30.000Z'),
        gracefulStoppedAt: null,
      },
    ]);
    const repository = new ComponentHeartbeatRepository({
      $queryRaw: queryRaw,
    } as unknown as PrismaClient);
    const samples = await repository.listForHealth();
    expect(samples).toEqual([
      {
        componentType: 'notification_worker',
        startedAt: '2026-08-08T12:00:00.000Z',
        latestHeartbeatAt: '2026-08-08T12:00:30.000Z',
        gracefulStoppedAt: null,
      },
    ]);
    expect(JSON.stringify(samples)).not.toMatch(
      /processInstanceId|hostname|ipAddress|osUsername/,
    );
  });
});
