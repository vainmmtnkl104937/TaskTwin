import type {
  RunnerAutonomyLevel,
  RunnerRuntimeMode,
  RunnerSecretUnlockMode,
  RunnerServiceStatus,
} from './contracts.js';

export const RUNNER_SERVICE_CAPABILITY = 'runner_service_v1' as const;
export const OS_NATIVE_SECRET_UNLOCK_CAPABILITY = 'os_native_secret_unlock_v1' as const;
export const SCHEDULED_EXECUTION_CAPABILITY = 'scheduled_execution_v1' as const;
export const LOCAL_SECRET_STORE_CAPABILITY = 'local_secret_store_v1' as const;

export type RunnerServiceCapability =
  | typeof RUNNER_SERVICE_CAPABILITY
  | typeof OS_NATIVE_SECRET_UNLOCK_CAPABILITY
  | typeof SCHEDULED_EXECUTION_CAPABILITY
  | typeof LOCAL_SECRET_STORE_CAPABILITY;

export interface RunnerCapabilityStateInput {
  runtimeMode: RunnerRuntimeMode;
  headed: boolean;
  jobWorkerAvailable: boolean;
  browserAvailable: boolean;
  serviceVerified: boolean;
  nativeProtectorAvailable: boolean;
  nativeUnlockVerified: boolean;
  configuredUnlockMode: RunnerSecretUnlockMode;
  vaultReady: boolean;
  localSecretProviderAvailable: boolean;
  inventorySynchronized: boolean;
  draining: boolean;
}

export function deriveServiceCapabilities(
  input: RunnerCapabilityStateInput,
): RunnerServiceCapability[] {
  const capabilities: RunnerServiceCapability[] = [];
  if (
    input.runtimeMode === 'service' &&
    input.serviceVerified &&
    !input.draining
  ) {
    capabilities.push(RUNNER_SERVICE_CAPABILITY);
  }
  if (
    !input.headed &&
    input.jobWorkerAvailable &&
    input.browserAvailable &&
    !input.draining
  ) {
    capabilities.push(SCHEDULED_EXECUTION_CAPABILITY);
  }
  if (
    !input.draining &&
    input.vaultReady &&
    input.localSecretProviderAvailable &&
    input.inventorySynchronized
  ) {
    capabilities.push(LOCAL_SECRET_STORE_CAPABILITY);
  }
  if (
    !input.draining &&
    input.runtimeMode === 'service' &&
    input.serviceVerified &&
    input.nativeProtectorAvailable &&
    input.nativeUnlockVerified &&
    input.vaultReady &&
    input.inventorySynchronized
  ) {
    capabilities.push(OS_NATIVE_SECRET_UNLOCK_CAPABILITY);
  }
  return capabilities;
}

export function deriveAutonomyLevel(
  input: RunnerCapabilityStateInput,
): RunnerAutonomyLevel {
  if (input.runtimeMode === 'interactive') return 'interactive';
  if (
    input.runtimeMode === 'service' &&
    input.serviceVerified &&
    input.nativeProtectorAvailable &&
    input.nativeUnlockVerified &&
    input.vaultReady &&
    input.inventorySynchronized
  ) {
    return 'boot_resilient';
  }
  return 'process_unattended';
}

export function deriveSecretUnlockMode(
  input: RunnerCapabilityStateInput,
): RunnerSecretUnlockMode {
  return input.configuredUnlockMode;
}

export function deriveServiceStatus(
  input: RunnerCapabilityStateInput,
): RunnerServiceStatus {
  if (input.runtimeMode !== 'service') return 'not_applicable';
  if (input.draining) return 'draining';
  if (!input.serviceVerified) return 'starting';
  if (input.nativeProtectorAvailable && !input.nativeUnlockVerified) {
    return 'degraded';
  }
  return 'running';
}
