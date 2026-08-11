import {
  createDatabaseClient,
  getRequiredDatabaseUrl,
} from '@tasktwin/database';

let client: ReturnType<typeof createDatabaseClient> | undefined;
try {
  client = createDatabaseClient(getRequiredDatabaseUrl());
  await client.$queryRaw`SELECT 1`;
} catch {
  console.error('NOTIFICATION_WORKER_HEALTHCHECK_FAILED');
  process.exitCode = 1;
} finally {
  await client?.$disconnect().catch(() => undefined);
}
