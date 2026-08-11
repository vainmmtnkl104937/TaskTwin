import type {
  PairingStatus,
  RunnerCapability,
  RunnerDeviceMetadata,
} from '@tasktwin/runner-protocol';

import type { OrganizationRole } from '../generated/prisma/client.js';
import type { LocalSecretStoreStatus } from '@tasktwin/local-secret-store';
import type { RunnerRuntimeMetadata } from '@tasktwin/runner-service-runtime';
import type {
  RunnerCompatibilityEvaluation,
  RunnerSoftwareIdentity,
} from '@tasktwin/runner-release';
import type { RunnerComplianceStatus } from '@tasktwin/runner-rollout';

export interface RunnerOrganizationAccess {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

export interface RunnerPairingRecord {
  id: string;
  status: PairingStatus;
  metadata: RunnerDeviceMetadata;
  workspaceId: string | null;
  expiresAt: Date;
  pollIntervalSeconds: number;
}

export interface RunnerDeviceRecord {
  id: string;
  workspaceId: string;
  metadata: RunnerDeviceMetadata;
  softwareIdentity: RunnerSoftwareIdentity | null;
  capabilities: RunnerCapability[];
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  runtime: RunnerRuntimeMetadata | null;
  desiredVersion: string | null;
  complianceStatus: RunnerComplianceStatus;
  localSecretStore: {
    status: LocalSecretStoreStatus;
    vaultRevision: number | null;
    configuredSecretCount: number;
    lastSynchronizedAt: Date | null;
    aliases: Array<{ alias: string; secretVersionId: string }>;
  } | null;
}

export interface RunnerDeviceListRecord {
  workspaceId: string;
  access: RunnerOrganizationAccess;
  devices: RunnerDeviceRecord[];
}

export interface RunnerAuthenticationRecord {
  runnerDeviceId: string;
  workspaceId: string;
  credentialId: string;
  credentialHash: string;
  deviceRevokedAt: Date | null;
  credentialRevokedAt: Date | null;
}

export interface RunnerHeartbeatPersistenceResult {
  runtime: RunnerRuntimeMetadata | null;
  compatibility: RunnerCompatibilityEvaluation;
  desiredVersion: string | null;
  complianceStatus: RunnerComplianceStatus;
}

export type RunnerPollingResult =
  | { status: 'authorization_pending'; intervalSeconds: number }
  | { status: 'slow_down'; intervalSeconds: number }
  | { status: 'access_denied' }
  | { status: 'expired' }
  | {
      status: 'paired';
      runnerDeviceId: string;
      workspaceId: string;
      intervalSeconds: number;
    };
