import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { summarizeComponentHealth } from '@tasktwin/operational-telemetry';

import {
  ComponentHeartbeatRepository,
  createDatabaseClient,
  getRequiredDatabaseUrl,
  type PrismaClient,
} from '../src/index.js';

describe('operational telemetry persistence', () => {
  let prisma: PrismaClient;
  let repository: ComponentHeartbeatRepository;
  const processIds = [randomUUID(), randomUUID()];

  beforeAll(async () => {
    prisma = createDatabaseClient(getRequiredDatabaseUrl());
    await prisma.$connect();
    repository = new ComponentHeartbeatRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$executeRaw`
      DELETE FROM "operational_component_heartbeats"
      WHERE "process_instance_id" IN (${processIds[0]}::uuid, ${processIds[1]}::uuid)
    `;
    await prisma.$disconnect();
  });

  it('records only safe fields and creates no audit events', async () => {
    const before = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS "count" FROM "workspace_audit_events"
    `;
    await repository.register({
      processInstanceId: processIds[0]!,
      componentType: 'scheduler',
    });
    await repository.refresh(processIds[0]!);
    await repository.stop(processIds[0]!);
    const after = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS "count" FROM "workspace_audit_events"
    `;
    expect(after[0]?.count).toBe(before[0]?.count);

    const columns = await prisma.$queryRaw<Array<{ columnName: string }>>`
      SELECT "column_name" AS "columnName" FROM "information_schema"."columns"
      WHERE "table_schema" = 'public' AND "table_name" = 'operational_component_heartbeats'
      ORDER BY "ordinal_position"
    `;
    expect(columns.map((column) => column.columnName)).toEqual([
      'process_instance_id',
      'component_type',
      'started_at',
      'latest_heartbeat_at',
      'graceful_stopped_at',
    ]);
  });

  it('treats one fresh unstopped instance as healthy', async () => {
    await repository.register({
      processInstanceId: processIds[1]!,
      componentType: 'scheduler',
    });
    const samples = await repository.listForHealth();
    const nowRows = await prisma.$queryRaw<
      Array<{ now: Date }>
    >`SELECT clock_timestamp() AS "now"`;
    const summary = summarizeComponentHealth({
      componentType: 'scheduler',
      samples,
      now: nowRows[0]!.now,
    });
    expect(summary.state).toBe('healthy');
  });
});
