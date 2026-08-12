import {
  createDatabaseClient,
  getRequiredDatabaseUrl,
  verifyRestoredDatabase,
  WorkflowRunRepository,
} from '../dist/index.js';
import { NotificationOutboxStore } from '../../../apps/notification-worker/dist/outbox-store.js';
import { InAppNotificationDeliveryProvider } from '../../../apps/notification-worker/dist/in-app-delivery.provider.js';
import { NotificationWorker } from '../../../apps/notification-worker/dist/worker.js';

const prisma = createDatabaseClient(getRequiredDatabaseUrl());
try {
  const before = await verifyRestoredDatabase(prisma);
  if (
    before.expiredActiveWorkflowRuns !== 1 ||
    before.pendingNotificationOutboxMessages !== 1 ||
    before.runnerDevices !== 1 ||
    before.runnerReleases !== 1 ||
    before.runnerRollouts !== 1
  ) {
    throw new Error('DRILL_RESTORED_STATE_MISMATCH');
  }

  const runs = new WorkflowRunRepository(prisma);
  const reconciled = await runs.reconcileExpiredLeases(new Date(), 100);
  if (reconciled !== 1) throw new Error('DRILL_EXPIRED_RUN_NOT_INTERRUPTED');
  const interrupted = await prisma.workflowRun.findFirstOrThrow();
  if (
    interrupted.status !== 'INTERRUPTED' ||
    interrupted.terminationCause !== 'lease_expired' ||
    interrupted.leaseTokenHash !== null ||
    interrupted.leaseExpiresAt !== null
  ) {
    throw new Error('DRILL_RUN_RESUME_INVARIANT_FAILED');
  }

  const worker = new NotificationWorker(
    'drill-notification-worker',
    new NotificationOutboxStore(prisma),
    new InAppNotificationDeliveryProvider(prisma),
  );
  const firstDelivery = await worker.runOnce();
  const repeatedDelivery = await worker.runOnce();
  const notificationCount = await prisma.userNotification.count();
  if (
    firstDelivery.delivered !== 1 ||
    repeatedDelivery.claimed !== 0 ||
    notificationCount !== 1
  ) {
    throw new Error('DRILL_NOTIFICATION_IDEMPOTENCY_FAILED');
  }

  const after = await verifyRestoredDatabase(prisma, {
    requireRecoveredRuns: true,
  });
  console.log(
    `DRILL_RECOVERY_COMPLETE ${JSON.stringify({ before, after, firstDelivery, repeatedDelivery })}`,
  );
} finally {
  await prisma.$disconnect();
}
