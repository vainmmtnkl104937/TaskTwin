import { describe, expect, it, vi } from 'vitest';
import type { NotificationDeliveryProvider } from '../src/delivery-provider.js';
import type { NotificationOutboxStore } from '../src/outbox-store.js';
import { NotificationWorker } from '../src/worker.js';

describe('NotificationWorker', () => {
  it('delivers a bounded claimed message once', async () => {
    const store = { claimDue: vi.fn(async () => [{ id: 'm1', attemptCount: 1, exhausted: false }]),
      retryOrDeadLetter: vi.fn() } as unknown as NotificationOutboxStore;
    const provider = { channel: 'IN_APP', deliver: vi.fn(async () => ({ outcome: 'delivered' as const })) } satisfies NotificationDeliveryProvider;
    await expect(new NotificationWorker('worker-1', store, provider).runOnce()).resolves.toEqual({ claimed: 1, delivered: 1, retried: 0, deadLettered: 0 });
    expect(provider.deliver).toHaveBeenCalledOnce();
  });

  it('reschedules retryable failures using only their safe code', async () => {
    const retry = vi.fn(async () => 'retry_scheduled' as const);
    const store = { claimDue: vi.fn(async () => [{ id: 'm1', attemptCount: 2, exhausted: false }]), retryOrDeadLetter: retry } as unknown as NotificationOutboxStore;
    const provider = { channel: 'IN_APP', deliver: vi.fn(async () => ({ outcome: 'retryable' as const, safeErrorCode: 'IN_APP_DELIVERY_TRANSIENT' })) } satisfies NotificationDeliveryProvider;
    const result = await new NotificationWorker('worker-1', store, provider).runOnce();
    expect(result.retried).toBe(1);
    expect(retry).toHaveBeenCalledWith(expect.objectContaining({ attemptCount: 2, retryable: true, safeErrorCode: 'IN_APP_DELIVERY_TRANSIENT' }));
  });

  it('dead-letters an exhausted recovered lease without invoking a provider', async () => {
    const deadLetter = vi.fn(async () => 'dead_lettered' as const);
    const store = { claimDue: vi.fn(async () => [{ id: 'm1', attemptCount: 5, exhausted: true }]), retryOrDeadLetter: deadLetter } as unknown as NotificationOutboxStore;
    const provider = { channel: 'IN_APP', deliver: vi.fn() } as unknown as NotificationDeliveryProvider;
    const result = await new NotificationWorker('worker-2', store, provider).runOnce();
    expect(result.deadLettered).toBe(1);
    expect(provider.deliver).not.toHaveBeenCalled();
    expect(deadLetter).toHaveBeenCalledWith(expect.objectContaining({ retryable: false, safeErrorCode: 'DELIVERY_ATTEMPTS_EXHAUSTED' }));
  });
});
