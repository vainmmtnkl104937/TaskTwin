import { randomUUID } from 'node:crypto';
import {
  ComponentHeartbeatRepository,
  createDatabaseClient,
  getRequiredDatabaseUrl,
} from '@tasktwin/database';
import { WorkerComponentHeartbeat } from './component-heartbeat.js';
import {
  loadRootEnvironment,
  validateNotificationWorkerEnvironment,
} from './environment.js';
import { InAppNotificationDeliveryProvider } from './in-app-delivery.provider.js';
import { NotificationOutboxStore } from './outbox-store.js';
import { NotificationWorker } from './worker.js';

const IDLE_DELAY_MS = 1_000;

async function run(): Promise<void> {
  loadRootEnvironment();
  validateNotificationWorkerEnvironment();

  const prisma = createDatabaseClient(getRequiredDatabaseUrl());
  const processInstanceId = randomUUID();
  const worker = new NotificationWorker(
    `notification-worker-${processInstanceId}`,
    new NotificationOutboxStore(prisma),
    new InAppNotificationDeliveryProvider(prisma),
  );
  const heartbeat = new WorkerComponentHeartbeat(
    new ComponentHeartbeatRepository(prisma),
    processInstanceId,
    'notification_worker',
  );
  let stopping = false;
  process.once('SIGINT', () => {
    stopping = true;
  });
  process.once('SIGTERM', () => {
    stopping = true;
  });

  try {
    await heartbeat.start();
    while (!stopping) {
      try {
        const result = await worker.runOnce();
        if (result.claimed === 0) {
          await new Promise((resolve) => setTimeout(resolve, IDLE_DELAY_MS));
        }
      } catch {
        console.error('NOTIFICATION_WORKER_CYCLE_FAILED');
        await new Promise((resolve) => setTimeout(resolve, IDLE_DELAY_MS));
      }
    }
  } finally {
    await heartbeat.stop();
    await prisma.$disconnect();
  }
}

void run().catch(() => {
  console.error('NOTIFICATION_WORKER_STARTUP_FAILED');
  process.exitCode = 1;
});
