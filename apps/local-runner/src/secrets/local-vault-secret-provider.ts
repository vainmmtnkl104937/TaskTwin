import {
  LocalSecretStoreError,
  type LocalSecretInventoryPin,
} from '@tasktwin/local-secret-store';
import {
  InMemorySecretProvider,
  SecureRunInputError,
  type SecretLease,
  type SecretProvider,
  type SecureSecretRequirement,
} from '@tasktwin/secure-run-inputs';

import { clearValues, type LocalSecretVaultService } from './local-secret-vault-service.js';

export class LocalVaultSecretProvider implements SecretProvider {
  private expectedPin: LocalSecretInventoryPin | undefined;

  constructor(private readonly vault: LocalSecretVaultService) {}

  setExpectedPin(pin: LocalSecretInventoryPin | undefined): void {
    this.expectedPin = pin;
  }

  isAvailable(): boolean {
    return this.expectedPin !== undefined;
  }

  async isReady(): Promise<boolean> {
    return this.vault.isReady();
  }

  async acquire(
    requirements: readonly SecureSecretRequirement[],
    signal: AbortSignal,
  ): Promise<SecretLease> {
    if (signal.aborted) throw new SecureRunInputError('SECRET_PROMPT_CANCELLED');
    if (!(await this.vault.isReady()) || this.expectedPin === undefined) {
      throw new SecureRunInputError('SECRET_UNAVAILABLE');
    }
    let values: Record<string, string> | null = null;
    try {
      values = await this.vault.acquireValues(requirements, this.expectedPin);
      return await new InMemorySecretProvider(values).acquire(requirements, signal);
    } catch (error: unknown) {
      if (error instanceof LocalSecretStoreError) {
        throw new SecureRunInputError('SECRET_UNAVAILABLE');
      }
      throw error;
    } finally {
      if (values !== null) clearValues(values);
    }
  }
}
