import { randomUUID } from 'node:crypto';
import {
  ComponentHeartbeatRepository,
  createDatabaseClient,
  getRequiredDatabaseUrl,
} from '@tasktwin/database';
import { WorkerComponentHeartbeat } from './component-heartbeat.js';
import { InAppNotificationDeliveryProvider } from './in-app-delivery.provider.js';
import { NotificationOutboxStore } from './outbox-store.js';
import { NotificationWorker } from './worker.js';

const prisma = createDatabaseClient(getRequiredDatabaseUrl());
const processInstanceId = randomUUID();
const workerId = `notification-worker-${processInstanceId}`;
const worker = new NotificationWorker(
  workerId,
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
      if (result.claimed === 0)
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    } catch {
      console.error('NOTIFICATION_WORKER_CYCLE_FAILED');
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
} finally {
  await heartbeat.stop();
  await prisma.$disconnect();
}
