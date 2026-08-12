import type { NotificationDeliveryProvider } from './delivery-provider.js';
import { NotificationOutboxStore } from './outbox-store.js';

export class NotificationWorker {
  private readonly deliveryConcurrency = 5;

  constructor(
    private readonly workerId: string,
    private readonly store: NotificationOutboxStore,
    private readonly provider: NotificationDeliveryProvider,
  ) {}

  async runOnce(): Promise<{
    claimed: number;
    delivered: number;
    retried: number;
    deadLettered: number;
  }> {
    const claimed = await this.store.claimDue({
      workerId: this.workerId,
      batchSize: 25,
      leaseSeconds: 30,
    });
    let delivered = 0,
      retried = 0,
      deadLettered = 0;
    for (
      let offset = 0;
      offset < claimed.length;
      offset += this.deliveryConcurrency
    ) {
      const outcomes = await Promise.all(
        claimed
          .slice(offset, offset + this.deliveryConcurrency)
          .map((message) => this.processMessage(message)),
      );
      for (const outcome of outcomes) {
        if (outcome === 'delivered') delivered += 1;
        if (outcome === 'retry_scheduled') retried += 1;
        if (outcome === 'dead_lettered') deadLettered += 1;
      }
    }
    return { claimed: claimed.length, delivered, retried, deadLettered };
  }

  private async processMessage(message: {
    id: string;
    attemptCount: number;
    exhausted: boolean;
  }): Promise<
    'delivered' | 'retry_scheduled' | 'dead_lettered' | 'lost_lease'
  > {
    if (message.exhausted) {
      return this.store.retryOrDeadLetter({
        messageId: message.id,
        workerId: this.workerId,
        attemptCount: message.attemptCount,
        retryable: false,
        safeErrorCode: 'DELIVERY_ATTEMPTS_EXHAUSTED',
      });
    }
    const result = await this.provider.deliver(message.id, this.workerId);
    if (result.outcome === 'delivered') return 'delivered';
    return this.store.retryOrDeadLetter({
      messageId: message.id,
      workerId: this.workerId,
      attemptCount: message.attemptCount,
      retryable: result.outcome === 'retryable',
      safeErrorCode: result.safeErrorCode,
    });
  }
}
