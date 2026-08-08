import { describe, expect, it } from 'vitest';

import {
  RunnerRuntimeMetadataSchema,
  RunnerServiceRuntimeError,
  assertRunnerLifecycleTransition,
  canTransitionRunnerLifecycle,
  classifyHttpConnectionFailure,
  decideRunnerDrain,
  deriveAutonomyLevel,
  deriveServiceCapabilities,
  reconnectDelayMilliseconds,
} from '../src/index.js';

const readyService = {
  runtimeMode: 'service' as const,
  headed: false,
  jobWorkerAvailable: true,
  browserAvailable: true,
  serviceVerified: true,
  nativeProtectorAvailable: true,
  nativeUnlockVerified: true,
  configuredUnlockMode: 'os_native' as const,
  vaultReady: true,
  localSecretProviderAvailable: true,
  inventorySynchronized: true,
  draining: false,
};

describe('runner service runtime', () => {
  it('validates lifecycle transitions', () => {
    expect(canTransitionRunnerLifecycle('ready', 'draining')).toBe(true);
    expect(canTransitionRunnerLifecycle('created', 'ready')).toBe(false);
    expect(() => assertRunnerLifecycleTransition('created', 'ready')).toThrow(
      new RunnerServiceRuntimeError('RUNNER_RUNTIME_TRANSITION_INVALID'),
    );
  });

  it('bounds deterministic reconnect delays', () => {
    expect([1, 2, 3, 7, 20].map(reconnectDelayMilliseconds)).toEqual([
      1_000, 2_000, 4_000, 60_000, 60_000,
    ]);
    expect(classifyHttpConnectionFailure(null)).toBe('retryable');
    expect(classifyHttpConnectionFailure(503)).toBe('retryable');
    expect(classifyHttpConnectionFailure(403)).toBe('permanent');
  });

  it('derives drain decisions', () => {
    expect(decideRunnerDrain({ activeRun: false, elapsedMilliseconds: 0 })).toBe('complete');
    expect(decideRunnerDrain({ activeRun: true, elapsedMilliseconds: 1_000 })).toBe('wait');
    expect(decideRunnerDrain({ activeRun: true, elapsedMilliseconds: 60_000 })).toBe('cancel');
  });

  it('derives boot-resilient capabilities only from verified state', () => {
    expect(deriveAutonomyLevel(readyService)).toBe('boot_resilient');
    expect(deriveServiceCapabilities(readyService)).toEqual([
      'runner_service_v1',
      'scheduled_execution_v1',
      'local_secret_store_v1',
      'os_native_secret_unlock_v1',
    ]);
    expect(deriveServiceCapabilities({ ...readyService, nativeUnlockVerified: false }))
      .not.toContain('os_native_secret_unlock_v1');
    expect(deriveServiceCapabilities({ ...readyService, draining: true })).toEqual([]);
  });

  it('rejects unexpected runtime metadata properties', () => {
    expect(RunnerRuntimeMetadataSchema.safeParse({
      schemaVersion: 1,
      runtimeMode: 'service',
      autonomyLevel: 'boot_resilient',
      serviceStatus: 'running',
      secretUnlockMode: 'os_native',
      restartResilient: true,
      runtimeMetadataRevision: 1,
      hostname: 'forbidden',
    }).success).toBe(false);
  });
});
