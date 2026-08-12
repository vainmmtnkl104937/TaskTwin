import {
  createDatabaseClient,
  getRequiredDatabaseUrl,
  verifyRestoredDatabase,
} from '../dist/index.js';

const prisma = createDatabaseClient(getRequiredDatabaseUrl());
try {
  const result = await verifyRestoredDatabase(prisma, {
    requireRecoveredRuns:
      process.env.TASKTWIN_RESTORE_REQUIRE_RECOVERED_RUNS === 'true',
  });
  console.log(`RESTORE_VERIFICATION_COMPLETE ${JSON.stringify(result)}`);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'RESTORE_VERIFICATION_FAILED',
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
