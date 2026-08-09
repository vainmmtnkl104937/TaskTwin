import { describe, expect, it, vi } from 'vitest';

import type { BrowserSessionFactory } from '../execution/browser-session.js';
import { LocalRunnerStartupHealthProbe } from './startup-health.js';

describe('Local Runner startup health probe', () => {
  it('proves engine, policy, Chromium, local-store, and native unlock readiness', async () => {
    const close = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ close });
    const probe = new LocalRunnerStartupHealthProbe({
      create,
    } as unknown as BrowserSessionFactory);
    await expect(
      probe.run({
        identityMatches: true,
        instanceLockHeld: true,
        localSecretStoreHealthy: true,
        nativeSecretAutoUnlockRequired: true,
        nativeSecretAutoUnlockVerified: true,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      identity: 'passed',
      instanceLock: 'passed',
      workflowEngine: 'passed',
      policyRuntime: 'passed',
      chromium: 'passed',
      localSecretStore: 'passed',
      nativeSecretAutoUnlock: 'passed',
    });
    expect(create).toHaveBeenCalledWith({
      headless: true,
      actionTimeoutMs: 10_000,
      navigationTimeoutMs: 30_000,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('fails closed when Chromium or a required native unlock is unavailable', async () => {
    const probe = new LocalRunnerStartupHealthProbe({
      create: vi.fn().mockRejectedValue(new Error('unavailable')),
    } as unknown as BrowserSessionFactory);
    await expect(
      probe.run({
        identityMatches: true,
        instanceLockHeld: true,
        localSecretStoreHealthy: false,
        nativeSecretAutoUnlockRequired: true,
        nativeSecretAutoUnlockVerified: false,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      chromium: 'failed',
      localSecretStore: 'failed',
      nativeSecretAutoUnlock: 'failed',
    });
  });
});
