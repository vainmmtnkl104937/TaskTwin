export type RunnerSecretInventoryRepositoryErrorCode =
  | 'RUNNER_UNAVAILABLE'
  | 'INVENTORY_NOT_INITIALIZED'
  | 'INVENTORY_INVALID'
  | 'INVENTORY_REVISION_CONFLICT'
  | 'INVENTORY_ROLLBACK_DETECTED'
  | 'VAULT_IDENTITY_CONFLICT';

export class RunnerSecretInventoryRepositoryError extends Error {
  constructor(readonly code: RunnerSecretInventoryRepositoryErrorCode) {
    super(code);
    this.name = 'RunnerSecretInventoryRepositoryError';
  }
}
