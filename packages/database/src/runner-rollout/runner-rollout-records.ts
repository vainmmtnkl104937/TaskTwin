import type { OrganizationRole } from '../generated/prisma/client.js';

export interface RunnerRolloutAccess {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
}

export interface RunnerRolloutAssignmentRecord {
  id: string;
  runnerDeviceId: string;
  runnerDisplayName: string;
  status: string;
  baselineVersion: string | null;
  lastObservedVersion: string | null;
  assignedAt: Date | null;
  convergedAt: Date | null;
  rolledBackAt: Date | null;
}

export interface RunnerRolloutStageRecord {
  id: string;
  stageNumber: number;
  status: string;
  reviewReason: string | null;
  activatedAt: Date | null;
  completedAt: Date | null;
  assignments: RunnerRolloutAssignmentRecord[];
}

export interface RunnerRolloutRecord {
  id: string;
  workspaceId: string;
  clientRolloutId: string;
  status: string;
  reviewReason: string | null;
  targetRelease: {
    id: string;
    product: string;
    version: string;
    status: string;
  };
  createdByUserId: string;
  activatedAt: Date | null;
  pausedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  stages: RunnerRolloutStageRecord[];
}
