import type { SecureSecretRequirement } from './contracts.js';
import { SecureRunInputError } from './errors.js';

export interface SecretLease {
  has(secretName: string): boolean;
  resolve(secretName: string): string;
  dispose(): Promise<void>;
}

export interface SecretProvider {
  isAvailable(): boolean;
  acquire(
    requirements: readonly SecureSecretRequirement[],
    signal: AbortSignal,
  ): Promise<SecretLease>;
}

class InMemorySecretLease implements SecretLease {
  private disposed = false;

  constructor(private readonly values: Map<string, string>) {}

  has(secretName: string): boolean {
    return !this.disposed && this.values.has(secretName);
  }

  resolve(secretName: string): string {
    if (this.disposed || !this.values.has(secretName)) {
      throw new SecureRunInputError('SECRET_UNAVAILABLE');
    }
    return this.values.get(secretName)!;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const key of this.values.keys()) this.values.set(key, '');
    this.values.clear();
  }
}

export class InMemorySecretProvider implements SecretProvider {
  constructor(
    private readonly configuredValues: Readonly<Record<string, string>>,
  ) {}

  isAvailable(): boolean {
    return true;
  }

  async acquire(
    requirements: readonly SecureSecretRequirement[],
    signal: AbortSignal,
  ): Promise<SecretLease> {
    if (signal.aborted)
      throw new SecureRunInputError('SECRET_PROMPT_CANCELLED');
    const values = new Map<string, string>();
    for (const requirement of requirements) {
      const value = this.configuredValues[requirement.secretName];
      if (value === undefined)
        throw new SecureRunInputError('SECRET_UNAVAILABLE');
      values.set(requirement.secretName, value);
    }
    return new InMemorySecretLease(values);
  }
}
