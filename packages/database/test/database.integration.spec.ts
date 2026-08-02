import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
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

describe('database integration', () => {
  let prisma: PrismaClient | undefined;

  beforeAll(async () => {
    prisma = createDatabaseClient(getRequiredDatabaseUrl());
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('connects to PostgreSQL and finds the applied Session 20 migration', async () => {
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
        AND migration_name = '20260802090000_ephemeral_workflow_outputs'
    `;

    expect(connectionResult[0]?.value).toBe(1);
    expect(migrationResult[0]?.count).toBe(1n);
  });
});
