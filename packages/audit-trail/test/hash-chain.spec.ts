import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createAuditEventHash,
  createAuditPayloadDigest,
  GENESIS_PREVIOUS_HASH,
  type AuditHashContent,
  type AuditHasher,
} from '../src/index.js';

const hasher: AuditHasher = {
  sha256Hex: (input) => createHash('sha256').update(input, 'utf8').digest('hex'),
};
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000010';
const USER_ID = '00000000-0000-4000-8000-000000000011';
const VERSION_ID = '00000000-0000-4000-8000-000000000012';

function content(
  sequence: number,
  previousHash: string,
  payloadDigest: string,
): AuditHashContent {
  return {
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    sequence,
    eventType: 'workflow_version.created',
    actor: { type: 'user', userId: USER_ID },
    primaryEntity: { kind: 'workflow_version', id: VERSION_ID },
    relatedEntities: [{ kind: 'workflow', id: 'workflow-1' }],
    occurredAt: '2026-08-05T12:00:00.000Z',
    sourceId: `workflow-version:${sequence}`,
    payloadDigest,
    previousHash,
  };
}

describe('audit hash chain', () => {
  it('creates deterministic payload and event digests', () => {
    const firstPayload = { revision: 1, version: 2 };
    const secondPayload = { version: 2, revision: 1 };
    const firstDigest = createAuditPayloadDigest(hasher, firstPayload);
    expect(firstDigest).toBe(createAuditPayloadDigest(hasher, secondPayload));
    expect(firstDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(createAuditEventHash(hasher, content(1, GENESIS_PREVIOUS_HASH, firstDigest))).toBe(
      createAuditEventHash(hasher, content(1, GENESIS_PREVIOUS_HASH, firstDigest)),
    );
  });

  it('uses the zero hash for genesis and links subsequent events', () => {
    const firstDigest = createAuditPayloadDigest(hasher, { version: 1 });
    const first = content(1, GENESIS_PREVIOUS_HASH, firstDigest);
    const firstHash = createAuditEventHash(hasher, first);
    const second = content(
      2,
      firstHash,
      createAuditPayloadDigest(hasher, { version: 2 }),
    );
    expect(first.previousHash).toBe('0'.repeat(64));
    expect(second.previousHash).toBe(firstHash);
    expect(createAuditEventHash(hasher, second)).not.toBe(firstHash);
  });
});
