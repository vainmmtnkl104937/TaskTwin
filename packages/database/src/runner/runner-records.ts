import type {
  PairingStatus,
  RunnerCapability,
  RunnerDeviceMetadata,
} from '@tasktwin/runner-protocol';

import type { OrganizationRole } from '../generated/prisma/client.js';

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
  capabilities: RunnerCapability[];
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
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
