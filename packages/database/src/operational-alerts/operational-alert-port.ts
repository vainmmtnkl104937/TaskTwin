import type { TrustedOperationalAlertInput } from '@tasktwin/operational-alerts';

import type { Prisma } from '../generated/prisma/client.js';

export type DatabaseTransactionClient = Prisma.TransactionClient;

export type OperationalAlertResolutionReason =
  | 'approved' | 'rejected' | 'expired' | 'cancelled' | 'invalidated'
  | 'retry_approved' | 'aborted' | 'resumed' | 'archived';

export interface ResolveOperationalAlertInput {
  workspaceId: string;
  type: TrustedOperationalAlertInput['type'];
  sourceType: TrustedOperationalAlertInput['source']['type'];
  sourceId: string;
  reason: OperationalAlertResolutionReason;
  resolvedByUserId?: string;
}

export interface OperationalAlertTransactionAppender {
  append(
    tx: DatabaseTransactionClient,
    input: TrustedOperationalAlertInput,
  ): Promise<{ alertId: string; recipientCount: number; idempotent: boolean }>;
  resolve(
    tx: DatabaseTransactionClient,
    input: ResolveOperationalAlertInput,
  ): Promise<{ alertId: string; idempotent: boolean } | null>;
}
