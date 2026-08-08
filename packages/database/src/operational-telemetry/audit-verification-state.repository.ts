import { OperationalTelemetryError } from '@tasktwin/operational-telemetry';

import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

type QueryClient = PrismaClient | Prisma.TransactionClient;

export interface AuditVerificationStateRecord {
  workspaceId: string;
  valid: boolean;
  checkedEventCount: number;
  firstSequence: number | null;
  lastSequence: number | null;
  failureSequence: number | null;
  safeFailureCode: string | null;
  verifiedAt: Date;
  verifiedByUserId: string | null;
}

export class AuditVerificationStateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(workspaceId: string): Promise<AuditVerificationStateRecord | null> {
    const rows = await this.prisma.$queryRaw<AuditVerificationStateRecord[]>`
      SELECT "workspace_id" AS "workspaceId", "valid",
             "checked_event_count" AS "checkedEventCount",
             "first_sequence" AS "firstSequence", "last_sequence" AS "lastSequence",
             "failure_sequence" AS "failureSequence", "safe_failure_code" AS "safeFailureCode",
             "verified_at" AS "verifiedAt", "verified_by_user_id" AS "verifiedByUserId"
      FROM "workspace_audit_verification_states"
      WHERE "workspace_id" = ${workspaceId}::uuid
    `;
    return rows[0] ?? null;
  }

  async upsert(
    tx: QueryClient,
    input: Omit<AuditVerificationStateRecord, 'verifiedAt'>,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(input.checkedEventCount) ||
      input.checkedEventCount < 0
    ) {
      throw new OperationalTelemetryError('TELEMETRY_INVALID');
    }
    await tx.$executeRaw`
      INSERT INTO "workspace_audit_verification_states" (
        "workspace_id", "valid", "checked_event_count", "first_sequence", "last_sequence",
        "failure_sequence", "safe_failure_code", "verified_at", "verified_by_user_id"
      ) VALUES (
        ${input.workspaceId}::uuid, ${input.valid}, ${input.checkedEventCount},
        ${input.firstSequence}, ${input.lastSequence}, ${input.failureSequence},
        ${input.safeFailureCode}, clock_timestamp(), ${input.verifiedByUserId}::uuid
      )
      ON CONFLICT ("workspace_id") DO UPDATE SET
        "valid" = EXCLUDED."valid",
        "checked_event_count" = EXCLUDED."checked_event_count",
        "first_sequence" = EXCLUDED."first_sequence",
        "last_sequence" = EXCLUDED."last_sequence",
        "failure_sequence" = EXCLUDED."failure_sequence",
        "safe_failure_code" = EXCLUDED."safe_failure_code",
        "verified_at" = EXCLUDED."verified_at",
        "verified_by_user_id" = EXCLUDED."verified_by_user_id"
    `;
  }
}
