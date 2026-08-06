import type { StoredAuditEvent } from './appender.js';
import {
  createAuditEventHash,
  createAuditPayloadDigest,
  GENESIS_PREVIOUS_HASH,
} from './hash-chain.js';
import type { AuditHasher } from './hasher.js';

export const AUDIT_VERIFICATION_FAILURE_CODES = [
  'SEQUENCE_GAP',
  'PREVIOUS_HASH_MISMATCH',
  'PAYLOAD_DIGEST_MISMATCH',
  'EVENT_HASH_MISMATCH',
  'HEAD_HASH_MISMATCH',
] as const;

export type AuditVerificationFailureCode =
  (typeof AUDIT_VERIFICATION_FAILURE_CODES)[number];

export interface AuditVerificationResult {
  valid: boolean;
  checkedCount: number;
  firstSequence: number | null;
  lastSequence: number | null;
  computedHeadHash: string;
  storedHeadHash: string;
  failureSequence?: number;
  failureCode?: AuditVerificationFailureCode;
}

export interface AuditVerificationOptions {
  expectedFirstSequence?: number;
  expectedPreviousHash?: string;
  storedHeadHash: string;
  requireHeadMatch?: boolean;
}

function failure(
  base: Omit<AuditVerificationResult, 'valid'>,
  failureCode: AuditVerificationFailureCode,
  failureSequence: number,
): AuditVerificationResult {
  return { ...base, valid: false, failureCode, failureSequence };
}

export function verifyAuditEventChain(
  hasher: AuditHasher,
  events: readonly StoredAuditEvent[],
  options: AuditVerificationOptions,
): AuditVerificationResult {
  const expectedFirstSequence = options.expectedFirstSequence ?? 1;
  let expectedSequence = expectedFirstSequence;
  let previousHash = options.expectedPreviousHash ?? GENESIS_PREVIOUS_HASH;
  const firstSequence = events[0]?.sequence ?? null;
  let checkedCount = 0;

  for (const event of events) {
    const base = {
      checkedCount,
      firstSequence,
      lastSequence: checkedCount === 0 ? null : expectedSequence - 1,
      computedHeadHash: previousHash,
      storedHeadHash: options.storedHeadHash,
    };
    if (event.sequence !== expectedSequence) {
      return failure(base, 'SEQUENCE_GAP', event.sequence);
    }
    if (event.previousHash !== previousHash) {
      return failure(base, 'PREVIOUS_HASH_MISMATCH', event.sequence);
    }
    if (createAuditPayloadDigest(hasher, event.payload) !== event.payloadDigest) {
      return failure(base, 'PAYLOAD_DIGEST_MISMATCH', event.sequence);
    }
    if (createAuditEventHash(hasher, event) !== event.eventHash) {
      return failure(base, 'EVENT_HASH_MISMATCH', event.sequence);
    }
    checkedCount += 1;
    expectedSequence += 1;
    previousHash = event.eventHash;
  }

  const base = {
    checkedCount,
    firstSequence,
    lastSequence: events.at(-1)?.sequence ?? null,
    computedHeadHash: previousHash,
    storedHeadHash: options.storedHeadHash,
  };
  if ((options.requireHeadMatch ?? true) && previousHash !== options.storedHeadHash) {
    return failure(
      base,
      'HEAD_HASH_MISMATCH',
      events.at(-1)?.sequence ?? expectedFirstSequence,
    );
  }
  return { ...base, valid: true };
}
