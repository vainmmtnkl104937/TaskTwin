'use client';

import { useState } from 'react';
import type { JSX } from 'react';

import { verifyAuditTrailAction } from '@/app/(authenticated)/workspaces/[workspaceId]/audit/actions';
import type { AuditVerifyResponse } from '@/lib/control-plane-contracts';

type VerifyStatus = 'idle' | 'pending' | 'ok' | 'tampered' | 'sequence_gap' | 'error';

interface AuditVerifyButtonProps {
  workspaceId: string;
}

const STATUS_LABEL: Record<AuditVerifyResponse['status'], string> = {
  ok: 'Audit chain verified',
  tampered: 'Audit chain mismatch',
  sequence_gap: 'Audit chain has a gap',
};

const FAILURE_KIND_LABEL: Record<string, string> = {
  SEQUENCE_GAP: 'Sequence gap',
  PREVIOUS_HASH_MISMATCH: 'Previous hash mismatch',
  PAYLOAD_DIGEST_MISMATCH: 'Payload digest mismatch',
  EVENT_HASH_MISMATCH: 'Event hash mismatch',
  HEAD_HASH_MISMATCH: 'Head hash mismatch',
};

export function AuditVerifyButton({
  workspaceId,
}: AuditVerifyButtonProps): JSX.Element {
  const [status, setStatus] = useState<VerifyStatus>('idle');
  const [result, setResult] = useState<AuditVerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClick(): Promise<void> {
    setStatus('pending');
    setError(null);
    try {
      const outcome = await verifyAuditTrailAction({
        workspaceId,
        sampleLimit: 200,
      });
      if (!outcome.ok) {
        setStatus('error');
        setError(outcome.message);
        return;
      }
      setResult(outcome.result);
      setStatus(outcome.result.status);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <div className="audit-verify-panel panel">
      <button type="button" onClick={onClick} disabled={status === 'pending'}>
        {status === 'pending' ? 'Verifying...' : 'Verify audit chain'}
      </button>
      {result !== null ? (
        <section aria-live="polite">
          <h2>Verification result</h2>
          <p>
            <strong>Status:</strong> {STATUS_LABEL[result.status] ?? result.status}
          </p>
          <p>
            <strong>Checked:</strong> {result.checkedCount} event
            {result.checkedCount === 1 ? '' : 's'}
          </p>
          <p>
            <strong>First sequence:</strong> {result.firstSequence ?? '—'}
          </p>
          <p>
            <strong>Last sequence:</strong> {result.lastSequence ?? '—'}
          </p>
          <p>
            <strong>Head hash:</strong> <code>{result.headHash.slice(0, 16)}…</code>
          </p>
          {result.firstFailure !== undefined ? (
            <p className="error-banner">
              <strong>First failure:</strong> sequence {result.firstFailure.sequence}{' '}
              ({FAILURE_KIND_LABEL[result.firstFailure.kind] ?? result.firstFailure.kind})
            </p>
          ) : null}
        </section>
      ) : null}
      {error !== null ? (
        <p className="error-banner" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}