import { randomUUID } from 'node:crypto';
import { createDatabaseClient, getRequiredDatabaseUrl } from '@tasktwin/database';
import { InAppNotificationDeliveryProvider } from './in-app-delivery.provider.js';
import { NotificationOutboxStore } from './outbox-store.js';
import { NotificationWorker } from './worker.js';

const prisma = createDatabaseClient(getRequiredDatabaseUrl());
const workerId = `notification-worker-${randomUUID()}`;
const worker = new NotificationWorker(workerId, new NotificationOutboxStore(prisma), new InAppNotificationDeliveryProvider(prisma));
let stopping = false;
process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });

while (!stopping) {
  const result = await worker.runOnce();
  if (result.claimed === 0) await new Promise((resolve) => setTimeout(resolve, 1_000));
}
await prisma.$disconnect();
