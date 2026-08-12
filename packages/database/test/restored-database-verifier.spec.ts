import { describe, expect, it } from 'vitest';

import { createRunnerReleaseSystemAuditHash } from '../src/runner-release/system-audit-hash.js';

const fixture = {
  scope: 'runner-release-catalog',
  sequence: 1,
  eventType: 'runner.release.imported',
  actorUserId: '00000000-0000-4000-8000-000000000001',
  releaseId: '00000000-0000-4000-8000-000000000002',
  occurredAt: new Date('2026-08-12T00:00:00.000Z'),
  sourceId: 'runner-release-imported:fixture',
  payload: { releaseId: 'safe-release-id', version: '1.2.3' },
  previousHash: '0'.repeat(64),
} as const;

describe('restored database system audit verification primitive', () => {
  it('recomputes a deterministic release audit digest and chain hash', () => {
    const first = createRunnerReleaseSystemAuditHash(fixture);
    const second = createRunnerReleaseSystemAuditHash(fixture);

    expect(first).toEqual(second);
    expect(first.payloadDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.eventHash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('detects payload or previous-link tampering', () => {
    const original = createRunnerReleaseSystemAuditHash(fixture);
    const changedPayload = createRunnerReleaseSystemAuditHash({
      ...fixture,
      payload: { releaseId: 'safe-release-id', version: '9.9.9' },
    });
    const changedLink = createRunnerReleaseSystemAuditHash({
      ...fixture,
      previousHash: '1'.repeat(64),
    });

    expect(changedPayload.payloadDigest).not.toBe(original.payloadDigest);
    expect(changedPayload.eventHash).not.toBe(original.eventHash);
    expect(changedLink.eventHash).not.toBe(original.eventHash);
  });
});
