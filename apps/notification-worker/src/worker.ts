import type { NotificationDeliveryProvider } from './delivery-provider.js';
import { NotificationOutboxStore } from './outbox-store.js';

export class NotificationWorker {
  constructor(
    private readonly workerId: string,
    private readonly store: NotificationOutboxStore,
    private readonly provider: NotificationDeliveryProvider,
  ) {}

  async runOnce(): Promise<{ claimed: number; delivered: number; retried: number; deadLettered: number }> {
    const claimed = await this.store.claimDue({ workerId: this.workerId, batchSize: 25, leaseSeconds: 30 });
    let delivered = 0, retried = 0, deadLettered = 0;
    for (const message of claimed) {
      if (message.exhausted) {
        const status = await this.store.retryOrDeadLetter({ messageId: message.id,
          workerId: this.workerId, attemptCount: message.attemptCount, retryable: false,
          safeErrorCode: 'DELIVERY_ATTEMPTS_EXHAUSTED' });
        if (status === 'dead_lettered') deadLettered += 1;
        continue;
      }
      const result = await this.provider.deliver(message.id, this.workerId);
      if (result.outcome === 'delivered') { delivered += 1; continue; }
      const status = await this.store.retryOrDeadLetter({
        messageId: message.id, workerId: this.workerId, attemptCount: message.attemptCount,
        retryable: result.outcome === 'retryable', safeErrorCode: result.safeErrorCode,
      });
      if (status === 'retry_scheduled') retried += 1;
      if (status === 'dead_lettered') deadLettered += 1;
    }
    return { claimed: claimed.length, delivered, retried, deadLettered };
  }
}
