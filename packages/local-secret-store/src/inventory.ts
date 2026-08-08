import {
  LOCAL_SECRET_INVENTORY_PROFILE,
  LOCAL_SECRET_STORE_SCHEMA_VERSION,
} from './constants.js';
import {
  LocalSecretDigestSchema,
  LocalSecretInventorySnapshotSchema,
  type LocalSecretInventoryEntry,
  type LocalSecretInventorySnapshot,
  type LocalSecretVault,
} from './contracts.js';
import { serializeLocalSecretCanonicalJson } from './canonical-json.js';

export interface LocalSecretDigestProvider {
  sha256Hex(input: string): string;
}

export function canonicalizeLocalSecretInventory(input: {
  vaultId: string;
  workspaceId: string;
  runnerDeviceId: string;
  vaultRevision: number;
  entries: readonly LocalSecretInventoryEntry[];
}): string {
  return serializeLocalSecretCanonicalJson({
    schemaVersion: LOCAL_SECRET_STORE_SCHEMA_VERSION,
    profile: LOCAL_SECRET_INVENTORY_PROFILE,
    vaultId: input.vaultId,
    workspaceId: input.workspaceId,
    runnerDeviceId: input.runnerDeviceId,
    vaultRevision: input.vaultRevision,
    entries: [...input.entries]
      .map((entry) => ({ alias: entry.alias, secretVersionId: entry.secretVersionId }))
      .sort((left, right) => left.alias.localeCompare(right.alias)),
  });
}

export function createLocalSecretInventoryDigest(
  provider: LocalSecretDigestProvider,
  input: Parameters<typeof canonicalizeLocalSecretInventory>[0],
): string {
  return LocalSecretDigestSchema.parse(
    provider.sha256Hex(canonicalizeLocalSecretInventory(input)),
  );
}

export function inventoryEntriesFromVault(
  vault: LocalSecretVault,
): LocalSecretInventoryEntry[] {
  return vault.records
    .map((record) => ({ alias: record.alias, secretVersionId: record.secretVersionId }))
    .sort((left, right) => left.alias.localeCompare(right.alias));
}

export function buildLocalSecretInventorySnapshot(
  vault: LocalSecretVault,
): LocalSecretInventorySnapshot {
  return LocalSecretInventorySnapshotSchema.parse({
    schemaVersion: 1,
    profile: LOCAL_SECRET_INVENTORY_PROFILE,
    vaultId: vault.vaultId,
    vaultRevision: vault.revision,
    inventoryDigest: vault.inventoryDigest,
    storeStatus: 'ready',
    entries: inventoryEntriesFromVault(vault),
  });
}

export function localSecretInventoryMatches(
  left: { vaultId: string; vaultRevision: number; inventoryDigest: string },
  right: { vaultId: string; vaultRevision: number; inventoryDigest: string },
): boolean {
  return left.vaultId === right.vaultId &&
    left.vaultRevision === right.vaultRevision &&
    left.inventoryDigest === right.inventoryDigest;
}
