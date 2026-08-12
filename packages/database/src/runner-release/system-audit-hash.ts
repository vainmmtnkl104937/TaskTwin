import { createHash } from 'node:crypto';

import { createCanonicalJsonDigest } from '../recording/canonical-json.js';

export const RUNNER_RELEASE_SYSTEM_AUDIT_SCOPE = 'runner-release-catalog';

export interface RunnerReleaseSystemAuditHashInput {
  scope: string;
  sequence: number;
  eventType: string;
  actorUserId: string;
  releaseId: string;
  occurredAt: Date;
  sourceId: string;
  payload: unknown;
  previousHash: string;
}

export function createRunnerReleaseSystemAuditHash(
  input: RunnerReleaseSystemAuditHashInput,
): { payloadDigest: string; eventHash: string } {
  const payloadDigest = createCanonicalJsonDigest(input.payload);
  const eventHash = createHash('sha256')
    .update(
      JSON.stringify({
        scope: input.scope,
        sequence: input.sequence,
        eventType: input.eventType,
        actorUserId: input.actorUserId,
        releaseId: input.releaseId,
        occurredAt: input.occurredAt.toISOString(),
        sourceId: input.sourceId,
        payloadDigest,
        previousHash: input.previousHash,
      }),
      'utf8',
    )
    .digest('hex');
  return { payloadDigest, eventHash };
}
