import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createAuditEventHash,
  createAuditPayloadDigest,
  GENESIS_PREVIOUS_HASH,
  verifyAuditEventChain,
  type AuditHashContent,
  type AuditHasher,
  type StoredAuditEvent,
} from '../src/index.js';
import {
  OCCURRED_AT,
  USER_ID,
  WORKFLOW_VERSION_ID,
  WORKSPACE_ID,
} from './fixtures.js';

const hasher: AuditHasher = {
  sha256Hex: (input) => createHash('sha256').update(input, 'utf8').digest('hex'),
};

function event(
  sequence: number,
  previousHash: string,
  payload: unknown,
): StoredAuditEvent {
  const payloadDigest = createAuditPayloadDigest(hasher, payload);
  const hashContent: AuditHashContent = {
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    sequence,
    eventType: 'workflow.created',
    actor: { type: 'user', userId: USER_ID },
    primaryEntity: { kind: 'workflow', id: 'workflow-1' },
    relatedEntities: [
      { kind: 'workflow_version', id: WORKFLOW_VERSION_ID },
    ],
    occurredAt: OCCURRED_AT,
    sourceId: `source:event-${sequence}`,
    payloadDigest,
    previousHash,
  };
  return {
    ...hashContent,
    id: `event-${sequence}`,
    payload,
    eventHash: createAuditEventHash(hasher, hashContent),
    createdAt: OCCURRED_AT,
  };
}

function validEvents(): StoredAuditEvent[] {
  const first = event(1, GENESIS_PREVIOUS_HASH, { workflowId: 'workflow-1' });
  return [first, event(2, first.eventHash, { workflowId: 'workflow-2' })];
}

describe('audit chain verification', () => {
  it('verifies a valid linked chain', () => {
    const events = validEvents();
    expect(
      verifyAuditEventChain(hasher, events, {
        storedHeadHash: events[1]?.eventHash ?? '',
      }),
    ).toMatchObject({ valid: true, checkedCount: 2, firstSequence: 1, lastSequence: 2 });
  });

  it('detects a sequence gap', () => {
    const events = validEvents();
    events[1] = { ...events[1]!, sequence: 3 };
    expect(
      verifyAuditEventChain(hasher, events, {
        storedHeadHash: events[1].eventHash,
      }),
    ).toMatchObject({ valid: false, failureCode: 'SEQUENCE_GAP', failureSequence: 3 });
  });

  it('detects a previous-hash mismatch', () => {
    const events = validEvents();
    events[1] = { ...events[1]!, previousHash: 'b'.repeat(64) };
    expect(
      verifyAuditEventChain(hasher, events, {
        storedHeadHash: events[1].eventHash,
      }),
    ).toMatchObject({ valid: false, failureCode: 'PREVIOUS_HASH_MISMATCH', failureSequence: 2 });
  });

  it('detects payload-digest tampering', () => {
    const events = validEvents();
    events[0] = { ...events[0]!, payload: { workflowId: 'tampered' } };
    expect(
      verifyAuditEventChain(hasher, events, {
        storedHeadHash: events[1]?.eventHash ?? '',
      }),
    ).toMatchObject({ valid: false, failureCode: 'PAYLOAD_DIGEST_MISMATCH', failureSequence: 1 });
  });

  it('detects event-hash tampering', () => {
    const events = validEvents();
    events[0] = { ...events[0]!, eventHash: 'c'.repeat(64) };
    expect(
      verifyAuditEventChain(hasher, events, {
        storedHeadHash: events[1]?.eventHash ?? '',
      }),
    ).toMatchObject({ valid: false, failureCode: 'EVENT_HASH_MISMATCH', failureSequence: 1 });
  });

  it('detects a chain-head mismatch', () => {
    const events = validEvents();
    expect(
      verifyAuditEventChain(hasher, events, {
        storedHeadHash: 'd'.repeat(64),
      }),
    ).toMatchObject({ valid: false, failureCode: 'HEAD_HASH_MISMATCH', failureSequence: 2 });
  });
});
