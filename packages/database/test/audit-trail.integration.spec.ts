import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuditSourceId, type AuditEventInput } from '@tasktwin/audit-trail';

import {
  WorkspaceAuditTrailRepository,
  appendAuditEventTransactional,
  auditHasherForTrail,
  createDatabaseClient,
  getRequiredDatabaseUrl,
  type PrismaClient,
} from '../src/index.js';

const rootEnvironmentPath = fileURLToPath(
  new URL('../../../.env', import.meta.url),
);

if (existsSync(rootEnvironmentPath)) {
  process.loadEnvFile(rootEnvironmentPath);
}

const ZERO_HASH = '0'.repeat(64);

function makeActor() {
  return {
    type: 'user' as const,
    userId: '00000000-0000-0000-0000-000000000001',
  };
}

function buildFixture(input: {
  workspaceId: string;
  sourceIdSalt: string;
  runId: string;
}): AuditEventInput {
  return {
    workspaceId: input.workspaceId,
    eventType: 'workflow_run.created',
    actor: makeActor(),
    primaryEntity: {
      kind: 'workflow_run',
      id: input.runId,
    },
    occurredAt: new Date(),
    sourceId: createAuditSourceId(
      'audit_trail_test',
      [input.sourceIdSalt],
      auditHasherForTrail,
    ),
    payload: {
      workflowRunId: input.runId,
      workflowId: '00000000-0000-0000-0000-000000000002',
      workflowVersionId: '00000000-0000-0000-0000-000000000003',
      runnerDeviceId: '00000000-0000-0000-0000-000000000004',
      workflowDigest: '0'.repeat(64),
      policyVersionId: '00000000-0000-0000-0000-000000000005',
      policyDigest: '0'.repeat(64),
    },
  };
}

async function workspaceIds(prisma: PrismaClient, count: number): Promise<string[]> {
  const organization = await prisma.organization.create({
    data: {
      name: 'audit-trail-test',
      slug: `audit-trail-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
  });
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const workspace = await prisma.workspace.create({
      data: {
        organizationId: organization.id,
        name: `audit-trail-workspace-${i}`,
        slug: `audit-trail-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      },
    });
    ids.push(workspace.id);
  }
  return ids;
}

async function cleanupWorkspace(
  prisma: PrismaClient,
  workspaceIds: string[],
): Promise<void> {
  await prisma.workspaceAuditEvent.deleteMany({
    where: { workspaceId: { in: workspaceIds } },
  });
  await prisma.workspaceAuditChainHead.deleteMany({
    where: { workspaceId: { in: workspaceIds } },
  });
  const workspaces = await prisma.workspace.findMany({
    where: { id: { in: workspaceIds } },
    select: { organizationId: true },
  });
  await prisma.workspace.deleteMany({
    where: { id: { in: workspaceIds } },
  });
  const organizationIds = [
    ...new Set(workspaces.map((workspace) => workspace.organizationId)),
  ];
  if (organizationIds.length > 0) {
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
  }
}

describe('workspace audit trail integration', () => {
  let prisma: PrismaClient | undefined;

  beforeAll(async () => {
    prisma = createDatabaseClient(getRequiredDatabaseUrl());
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('connects to PostgreSQL and applies the audit trail migration', async () => {
    if (prisma === undefined) {
      throw new Error('Database client was not initialized');
    }
    const connectionResult = await prisma.$queryRaw<Array<{ value: number }>>`
      SELECT 1 AS value
    `;
    const migrationResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL
        AND rolled_back_at IS NULL
        AND migration_name = '20260805120000_workspace_audit_trail'
    `;
    expect(connectionResult[0]?.value).toBe(1);
    expect(migrationResult[0]?.count).toBe(1n);
  });

  it('creates the audit tables, indexes, function, and triggers', async () => {
    if (prisma === undefined) {
      throw new Error('Database client was not initialized');
    }
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('workspace_audit_events', 'workspace_audit_chain_heads')
    `;
    const tableNames = tables.map((row) => row.table_name);
    expect(tableNames).toEqual(
      expect.arrayContaining(['workspace_audit_events', 'workspace_audit_chain_heads']),
    );

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'workspace_audit_events'
    `;
    const indexNames = indexes.map((row) => row.indexname);
    expect(indexNames).toEqual(
      expect.arrayContaining([
        'workspace_audit_events_workspace_source_id_key',
        'workspace_audit_events_workspace_sequence_key',
        'workspace_audit_events_workspace_event_type_idx',
        'workspace_audit_events_entity_idx',
      ]),
    );

    const functions = await prisma.$queryRaw<Array<{ proname: string }>>`
      SELECT proname FROM pg_proc WHERE proname = 'tasktwin_block_audit_mutation'
    `;
    expect(functions.length).toBe(1);

    const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = '"workspace_audit_events"'::regclass
        AND NOT tgisinternal
    `;
    const triggerNames = triggers.map((row) => row.tgname);
    expect(triggerNames).toEqual(
      expect.arrayContaining([
        'workspace_audit_events_block_update',
        'workspace_audit_events_block_delete',
        'workspace_audit_events_block_truncate',
      ]),
    );
  });

  it('appends the first event for workspace A with sequence 1 and zero hash', async () => {
    if (prisma === undefined) {
      throw new Error('Database client was not initialized');
    }
    const ids = await workspaceIds(prisma, 1);
    const workspaceId = ids[0];
    if (workspaceId === undefined) {
      throw new Error('workspaceId not created');
    }
    try {
      const trail = new WorkspaceAuditTrailRepository(prisma);
      const input = buildFixture({
        workspaceId,
        sourceIdSalt: 'first-event',
        runId: '11111111-1111-1111-1111-111111111111',
      });
      const result = await appendAuditEventTransactional(prisma, trail, input);
      expect(result.idempotent).toBe(false);
      expect(result.event.sequence).toBe(1);
      expect(result.event.previousHash).toBe(ZERO_HASH);
      expect(result.event.eventHash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await cleanupWorkspace(prisma, ids);
    }
  });

  it('handles concurrent appends in sequence order with linked previousHash', async () => {
    if (prisma === undefined) {
      throw new Error('Database client was not initialized');
    }
    const ids = await workspaceIds(prisma, 1);
    const workspaceId = ids[0];
    if (workspaceId === undefined) {
      throw new Error('workspaceId not created');
    }
    try {
      const trail = new WorkspaceAuditTrailRepository(prisma);
      const tasks = [
        appendAuditEventTransactional(
          prisma,
          trail,
          buildFixture({
            workspaceId,
            sourceIdSalt: 'concurrent-1',
            runId: '22222222-2222-2222-2222-222222222221',
          }),
        ),
        appendAuditEventTransactional(
          prisma,
          trail,
          buildFixture({
            workspaceId,
            sourceIdSalt: 'concurrent-2',
            runId: '22222222-2222-2222-2222-222222222222',
          }),
        ),
      ];
      const results = await Promise.all(tasks);
      const sequences = results.map((result) => result.event.sequence).sort();
      expect(sequences).toEqual([1, 2]);
      const ordered = [...results].sort(
        (a, b) => a.event.sequence - b.event.sequence,
      );
      expect(ordered[0]?.event.previousHash).toBe(ZERO_HASH);
      expect(ordered[1]?.event.previousHash).toBe(ordered[0]?.event.eventHash);
    } finally {
      await cleanupWorkspace(prisma, ids);
    }
  });

  it('keeps separate sequence chains per workspace', async () => {
    if (prisma === undefined) {
      throw new Error('Database client was not initialized');
    }
    const ids = await workspaceIds(prisma, 2);
    const workspaceA = ids[0];
    const workspaceB = ids[1];
    if (workspaceA === undefined || workspaceB === undefined) {
      throw new Error('workspaceIds not created');
    }
    try {
      const trail = new WorkspaceAuditTrailRepository(prisma);
      await appendAuditEventTransactional(
        prisma,
        trail,
        buildFixture({
          workspaceId: workspaceA,
          sourceIdSalt: 'workspace-a-1',
          runId: '33333333-3333-3333-3333-333333333331',
        }),
      );
      const workspaceBResult = await appendAuditEventTransactional(
        prisma,
        trail,
        buildFixture({
          workspaceId: workspaceB,
          sourceIdSalt: 'workspace-b-1',
          runId: '33333333-3333-3333-3333-333333333332',
        }),
      );
      expect(workspaceBResult.event.sequence).toBe(1);
      expect(workspaceBResult.event.previousHash).toBe(ZERO_HASH);
    } finally {
      await cleanupWorkspace(prisma, ids);
    }
  });

  it('is idempotent when the same sourceId is reused with the same payload', async () => {
    if (prisma === undefined) {
      throw new Error('Database client was not initialized');
    }
    const ids = await workspaceIds(prisma, 1);
    const workspaceId = ids[0];
    if (workspaceId === undefined) {
      throw new Error('workspaceId not created');
    }
    try {
      const trail = new WorkspaceAuditTrailRepository(prisma);
      const input = buildFixture({
        workspaceId,
        sourceIdSalt: 'idempotent-sourceId',
        runId: '44444444-4444-4444-4444-444444444444',
      });
      const first = await appendAuditEventTransactional(prisma, trail, input);
      const second = await appendAuditEventTransactional(prisma, trail, input);
      expect(first.idempotent).toBe(false);
      expect(second.idempotent).toBe(true);
      expect(second.event.id).toBe(first.event.id);
    } finally {
      await cleanupWorkspace(prisma, ids);
    }
  });

  it('raises AUDIT_SOURCE_CONFLICT when the same sourceId is reused with a different payload', async () => {
    if (prisma === undefined) {
      throw new Error('Database client was not initialized');
    }
    const ids = await workspaceIds(prisma, 1);
    const workspaceId = ids[0];
    if (workspaceId === undefined) {
      throw new Error('workspaceId not created');
    }
    try {
      const trail = new WorkspaceAuditTrailRepository(prisma);
      const sourceId = createAuditSourceId(
        'audit_trail_test',
        ['conflict-sourceId'],
        auditHasherForTrail,
      );
      const runId = '55555555-5555-5555-5555-555555555555';
      const first = await appendAuditEventTransactional(prisma, trail, {
        workspaceId,
        eventType: 'workflow_run.created',
        actor: makeActor(),
        primaryEntity: { kind: 'workflow_run', id: runId },
        occurredAt: new Date(),
        sourceId,
        payload: {
          workflowRunId: runId,
          workflowId: '00000000-0000-0000-0000-000000000002',
          workflowVersionId: '00000000-0000-0000-0000-000000000003',
          runnerDeviceId: '00000000-0000-0000-0000-000000000004',
          workflowDigest: '0'.repeat(64),
          policyVersionId: '00000000-0000-0000-0000-000000000005',
          policyDigest: '0'.repeat(64),
        },
      });
      expect(first.idempotent).toBe(false);
      await expect(
        appendAuditEventTransactional(prisma, trail, {
          workspaceId,
          eventType: 'workflow_run.created',
          actor: makeActor(),
          primaryEntity: { kind: 'workflow_run', id: runId },
          occurredAt: new Date(),
          sourceId,
          payload: {
            workflowRunId: '66666666-6666-6666-6666-666666666666',
            workflowId: '00000000-0000-0000-0000-000000000002',
            workflowVersionId: '00000000-0000-0000-0000-000000000003',
            runnerDeviceId: '00000000-0000-0000-0000-000000000004',
            workflowDigest: '0'.repeat(64),
            policyVersionId: '00000000-0000-0000-0000-000000000005',
            policyDigest: '0'.repeat(64),
          },
        }),
      ).rejects.toThrow('AUDIT_SOURCE_CONFLICT');
    } finally {
      await cleanupWorkspace(prisma, ids);
    }
  });

  it('blocks UPDATE, DELETE, and TRUNCATE on workspace_audit_events', async () => {
    if (prisma === undefined) {
      throw new Error('Database client was not initialized');
    }
    const ids = await workspaceIds(prisma, 1);
    const workspaceId = ids[0];
    if (workspaceId === undefined) {
      throw new Error('workspaceId not created');
    }
    try {
      const trail = new WorkspaceAuditTrailRepository(prisma);
      const seeded = await appendAuditEventTransactional(
        prisma,
        trail,
        buildFixture({
          workspaceId,
          sourceIdSalt: 'immutable-event',
          runId: '77777777-7777-7777-7777-777777777777',
        }),
      );
      const eventId = seeded.event.id;

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "workspace_audit_events" SET "event_type" = 'mutated' WHERE "id" = $1`,
          eventId,
        ),
      ).rejects.toThrow('AUDIT_EVENT_IMMUTABLE');

      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM "workspace_audit_events" WHERE "id" = $1`,
          eventId,
        ),
      ).rejects.toThrow('AUDIT_EVENT_IMMUTABLE');

      await expect(
        prisma.$executeRawUnsafe(
          `TRUNCATE "workspace_audit_events"`,
        ),
      ).rejects.toThrow('AUDIT_EVENT_IMMUTABLE');
    } finally {
      await cleanupWorkspace(prisma, ids);
    }
  });

  it('rolls back the audit append when the surrounding transaction fails', async () => {
    if (prisma === undefined) {
      throw new Error('Database client was not initialized');
    }
    const ids = await workspaceIds(prisma, 1);
    const workspaceId = ids[0];
    if (workspaceId === undefined) {
      throw new Error('workspaceId not created');
    }
    try {
      const trail = new WorkspaceAuditTrailRepository(prisma);
      const input = buildFixture({
        workspaceId,
        sourceIdSalt: 'rollback-event',
        runId: '88888888-8888-8888-8888-888888888888',
      });
      await expect(
        prisma.$transaction(async (transaction) => {
          await appendAuditEventTransactional(transaction, trail, input);
          throw new Error('simulated-transaction-failure');
        }),
      ).rejects.toThrow('simulated-transaction-failure');
      const remaining = await prisma.workspaceAuditEvent.count({
        where: { workspaceId },
      });
      expect(remaining).toBe(0);
    } finally {
      await cleanupWorkspace(prisma, ids);
    }
  });
});
