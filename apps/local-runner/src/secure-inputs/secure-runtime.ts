import {
  createRuntimeValueResolver,
  type WorkflowRuntimeValueResolver,
} from '@tasktwin/workflow-engine';
import type { ValueSource } from '@tasktwin/workflow-schema';
import type {
  RuntimeInputValue,
  ValueSourceTarget,
} from '@tasktwin/workflow-inputs';
import type {
  SecretLease,
  SecretProvider,
  SecureRunInputManifest,
} from '@tasktwin/secure-run-inputs';
import type { ClaimedRunInput } from '@tasktwin/run-protocol';

import { decryptRunInputs } from './decrypt-run-inputs.js';
import type { RunnerKeyManager } from './runner-key-manager.js';

export interface SecureRuntimeLease {
  resolver: WorkflowRuntimeValueResolver;
  dispose(): Promise<void>;
}

export async function acquireSecureRuntime(input: {
  runtimeInput: Extract<ClaimedRunInput, { kind: 'encrypted_envelope' }>;
  keyManager: RunnerKeyManager;
  secretProvider: SecretProvider;
  signal: AbortSignal;
  now: Date;
}): Promise<SecureRuntimeLease> {
  const localKey = await input.keyManager.loadRequired();
  const submission = decryptRunInputs({
    envelope: input.runtimeInput.envelope,
    aad: input.runtimeInput.aad,
    manifest: input.runtimeInput.manifest,
    localKey,
    now: input.now,
  });
  let secretLease: SecretLease | null = null;
  try {
    if (input.runtimeInput.manifest.secrets.length > 0) {
      secretLease = await input.secretProvider.acquire(
        input.runtimeInput.manifest.secrets,
        input.signal,
      );
    }
    const variables = createRuntimeValueResolver(submission.values);
    const resolver: WorkflowRuntimeValueResolver = {
      hasVariable: variables.hasVariable,
      hasSecret: (name) => secretLease?.has(name) ?? false,
      resolve: (source: ValueSource, target: ValueSourceTarget) =>
        source.kind === 'secret'
          ? requireSecret(secretLease, source.secretName)
          : variables.resolve(source, target),
    };
    return {
      resolver,
      dispose: async () => {
        await secretLease?.dispose();
        clearVariables(submission.values);
      },
    };
  } catch (error: unknown) {
    await secretLease?.dispose();
    clearVariables(submission.values);
    throw error;
  }
}

export async function acquireLocalSecretRuntime(input: {
  runtimeInput: Extract<ClaimedRunInput, { kind: 'local_secret_store' }>;
  secretProvider: SecretProvider;
  signal: AbortSignal;
}): Promise<SecureRuntimeLease> {
  let secretLease: SecretLease | null = null;
  try {
    secretLease = await input.secretProvider.acquire(
      input.runtimeInput.secrets,
      input.signal,
    );
    const variables = createRuntimeValueResolver({});
    const resolver: WorkflowRuntimeValueResolver = {
      hasVariable: variables.hasVariable,
      hasSecret: (name) => secretLease?.has(name) ?? false,
      resolve: (source, target) =>
        source.kind === 'secret'
          ? requireSecret(secretLease, source.secretName)
          : variables.resolve(source, target),
    };
    return {
      resolver,
      dispose: async () => {
        await secretLease?.dispose();
        secretLease = null;
      },
    };
  } catch (error: unknown) {
    await secretLease?.dispose();
    throw error;
  }
}

function requireSecret(lease: SecretLease | null, name: string): string {
  if (lease === null) throw new Error('Secret resolution is unavailable.');
  return lease.resolve(name);
}

function clearVariables(values: Record<string, RuntimeInputValue>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value.kind === 'string' || value.kind === 'date') value.value = '';
    else if (value.kind === 'number') value.value = 0;
    else if (value.kind === 'boolean') value.value = false;
    delete values[name];
  }
}

export function runnerSupportsInteractiveSecrets(
  provider: SecretProvider,
  manifest: SecureRunInputManifest,
): boolean {
  return manifest.secrets.length === 0 || provider.isAvailable();
}
