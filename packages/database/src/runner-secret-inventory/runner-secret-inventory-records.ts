import type { LocalSecretInventoryEntry, LocalSecretStoreStatus } from '@tasktwin/local-secret-store';

export interface RunnerSecretInventoryRecord {
  runnerDeviceId: string;
  workspaceId: string;
  vaultId: string;
  vaultRevision: number;
  storeStatus: LocalSecretStoreStatus;
  inventoryDigest: string;
  lastSynchronizedAt: Date;
  entries: LocalSecretInventoryEntry[];
}

export interface RunnerSecretInventorySyncResult {
  inventory: RunnerSecretInventoryRecord;
  idempotent: boolean;
}
