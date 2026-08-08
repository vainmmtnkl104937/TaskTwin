import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../src/index.js';

import { AuditVerificationStateRepository } from '../src/operational-telemetry/audit-verification-state.repository.js';

describe('AuditVerificationStateRepository', () => {
  it('persists only safe verification metadata with database time', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const repository = new AuditVerificationStateRepository({} as PrismaClient);
    await repository.upsert(
      { $executeRaw: executeRaw } as unknown as PrismaClient,
      {
        workspaceId: '00000000-0000-4000-8000-000000000028',
        valid: false,
        checkedEventCount: 8,
        firstSequence: 1,
        lastSequence: 8,
        failureSequence: 8,
        safeFailureCode: 'EVENT_HASH_MISMATCH',
        verifiedByUserId: '00000000-0000-4000-8000-000000000029',
      },
    );
    const sql = (executeRaw.mock.calls[0]?.[0] as TemplateStringsArray).join(
      '?',
    );
    expect(sql).toContain('clock_timestamp()');
    expect(sql).not.toMatch(/payload|event_hash|previous_hash|computed_hash/i);
  });
});
