import { describe, expect, it, vi } from 'vitest';

const appendAuditEventTransactional = vi.hoisted(() =>
  vi.fn(
    async (
      _transaction: unknown,
      _trail: unknown,
      _input: { eventType: string },
    ) => {
      void _transaction;
      void _trail;
      void _input;
    },
  ),
);

vi.mock(
  '../src/audit-trail/audit-appender.repository.js',
  async (loadActual) => {
    const actual =
      await loadActual<
        typeof import('../src/audit-trail/audit-appender.repository.js')
      >();
    return { ...actual, appendAuditEventTransactional };
  },
);

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { WorkflowScheduleRepository } from '../src/workflow-schedule/workflow-schedule.repository.js';

const scheduleId = '00000000-0000-4000-8000-000000000001';
const workspaceId = '00000000-0000-4000-8000-000000000002';
const workflowId = '00000000-0000-4000-8000-000000000003';
const workflowVersionId = '00000000-0000-4000-8000-000000000004';
const runnerDeviceId = '00000000-0000-4000-8000-000000000005';
const creatorUserId = '00000000-0000-4000-8000-000000000006';
const workflowRunId = '00000000-0000-4000-8000-000000000007';
const now = new Date('2026-08-09T08:00:00.000Z');

const workflowDefinition = {
  schemaVersion: 1,
  workflowId: 'scheduled-compatible-runner',
  version: 1,
  name: 'Scheduled compatibility fixture',
  status: 'published',
  variables: [],
  steps: [
    {
      id: 'wait-safely',
      type: 'wait',
      name: 'Wait safely',
      durationMs: 1,
    },
  ],
} as const;

const schedule = {
  id: scheduleId,
  workspaceId,
  workflowId,
  workflowVersionId,
  workflowVersion: { version: 1, definition: workflowDefinition },
  runnerDeviceId,
  definition: {
    schemaVersion: 1,
    type: 'one_time',
    timezone: 'UTC',
    date: '2026-08-09',
    time: '08:00',
  },
  maxStartDelaySeconds: 300,
  status: 'ACTIVE',
  nextOccurrenceAt: now,
  createdByUserId: creatorUserId,
} as const;

const activePolicy = {
  id: '00000000-0000-4000-8000-000000000008',
  revision: 1,
  digest: 'a'.repeat(64),
  definition: {
    schemaVersion: 1,
    network: {
      mode: 'workflow_declared_origins',
      allowedOrigins: [],
      blockedOrigins: [],
      allowLoopbackHttp: true,
    },
    unknownActionRisk: 'medium',
    approval: {
      threshold: 'high_or_above',
      criticalActionBehavior: 'deny',
    },
    rules: [],
  },
} as const;

function createRepository(runner: {
  runnerVersion: string;
  platform: string;
  architecture: string;
  runProtocolVersion: number | null;
  workflowSchemaVersion: number | null;
  localStateSchemaVersion: number | null;
}) {
  let storedOccurrence: Record<string, unknown> | null = null;
  const workflowRunCreate = vi.fn(async () => ({ id: workflowRunId }));
  const scheduleUpdate = vi.fn(async () => schedule);
  const alertAppend = vi.fn(async () => undefined);
  const occurrenceCreate = vi.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      storedOccurrence = {
        workflowRunId: null,
        skippedAt: null,
        dispatchedAt: null,
        completedAt: null,
        terminationCause: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      return storedOccurrence;
    },
  );
  const transaction = {
    $queryRaw: vi.fn(async () => [{ id: scheduleId }]),
    workflowSchedule: {
      findUnique: vi.fn(async () => schedule),
      update: scheduleUpdate,
    },
    workflowScheduleOccurrence: {
      findFirst: vi.fn(async () => null),
      create: occurrenceCreate,
      findUnique: vi.fn(async () => storedOccurrence),
    },
    runnerDevice: {
      findFirst: vi.fn(async () => ({
        revokedAt: null,
        lastSeenAt: now,
        capabilities: ['scheduled_execution_v1'],
        secretInventory: null,
        ...runner,
      })),
    },
    workspaceExecutionPolicyVersion: {
      findFirst: vi.fn(async () => activePolicy),
    },
    workflowRun: {
      findFirst: vi.fn(async () => null),
      create: workflowRunCreate,
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
    ),
  } as unknown as PrismaClient;
  const repository = new WorkflowScheduleRepository(prisma, undefined, {
    append: alertAppend,
  } as unknown as ConstructorParameters<typeof WorkflowScheduleRepository>[2]);
  return {
    repository,
    workflowRunCreate,
    scheduleUpdate,
    alertAppend,
  };
}

describe('scheduled Runner software compatibility', () => {
  it('dispatches normally for a compatible Runner', async () => {
    const test = createRepository({
      runnerVersion: '0.1.0',
      platform: 'win32',
      architecture: 'x64',
      runProtocolVersion: 2,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
    });

    const result = await test.repository.processOccurrence({ scheduleId, now });

    expect(result).toMatchObject({
      workflowRunId,
      idempotent: false,
    });
    expect(test.workflowRunCreate).toHaveBeenCalledOnce();
    expect(test.alertAppend).not.toHaveBeenCalled();
  });

  it('skips and auto-pauses before creating a run when an update is required', async () => {
    appendAuditEventTransactional.mockClear();
    const test = createRepository({
      runnerVersion: '0.1.0',
      platform: 'win32',
      architecture: 'x64',
      runProtocolVersion: null,
      workflowSchemaVersion: null,
      localStateSchemaVersion: null,
    });

    const result = await test.repository.processOccurrence({ scheduleId, now });

    expect(result).toMatchObject({
      workflowRunId: null,
      skipReason: 'runner_update_required',
      autoPaused: true,
      autoPauseReason: 'runner_update_required',
    });
    expect(test.workflowRunCreate).not.toHaveBeenCalled();
    expect(test.scheduleUpdate).toHaveBeenCalledWith({
      where: { id: scheduleId },
      data: expect.objectContaining({
        status: 'AUTO_PAUSED',
        autoPauseReason: 'runner_update_required',
        nextOccurrenceAt: null,
      }),
    });
    expect(appendAuditEventTransactional).toHaveBeenCalledTimes(2);
    expect(
      appendAuditEventTransactional.mock.calls.map((call) => call[2].eventType),
    ).toEqual(['schedule.occurrence.skipped', 'schedule.auto_paused']);
    expect(test.alertAppend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'schedule_auto_paused',
        source: {
          type: 'workflow_schedule_occurrence',
          id: expect.any(String),
        },
        template: expect.objectContaining({
          reason: 'runner_update_required',
        }),
      }),
    );
  });

  it('uses the same safe block for an unsupported Runner protocol', async () => {
    const test = createRepository({
      runnerVersion: '9.0.0',
      platform: 'win32',
      architecture: 'x64',
      runProtocolVersion: 999,
      workflowSchemaVersion: 1,
      localStateSchemaVersion: 1,
    });

    const result = await test.repository.processOccurrence({ scheduleId, now });

    expect(result).toMatchObject({
      workflowRunId: null,
      skipReason: 'runner_update_required',
      autoPaused: true,
      autoPauseReason: 'runner_update_required',
    });
    expect(test.workflowRunCreate).not.toHaveBeenCalled();
  });
});
