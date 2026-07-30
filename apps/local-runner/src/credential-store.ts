import type { StoredRunnerCredential } from '@tasktwin/runner-protocol';

export interface RunnerCredentialStore {
  load(): Promise<StoredRunnerCredential | null>;
  save(value: StoredRunnerCredential): Promise<void>;
  clear(): Promise<void>;
}

export class CredentialStoreError extends Error {
  constructor() {
    super('The local runner credential store is unavailable.');
    this.name = 'CredentialStoreError';
  }
}

export class InMemoryCredentialStore implements RunnerCredentialStore {
  private value: StoredRunnerCredential | null = null;

  async load(): Promise<StoredRunnerCredential | null> {
    return this.value === null ? null : structuredClone(this.value);
  }

  async save(value: StoredRunnerCredential): Promise<void> {
    this.value = structuredClone(value);
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}
