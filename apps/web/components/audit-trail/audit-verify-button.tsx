'use client';

import { useState } from 'react';
import type { JSX } from 'react';

import { verifyAuditTrailAction } from '@/app/(authenticated)/workspaces/[workspaceId]/audit/actions';
import type { AuditVerifyResponse } from '@/lib/control-plane-contracts';

type VerifyStatus = 'idle' | 'pending' | 'ok' | 'tampered' | 'sequence_gap' | 'error';

interface AuditVerifyButtonProps {
  workspaceId: string;
}

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
    <div>
      <button type="button" onClick={onClick} disabled={status === 'pending'}>
        {status === 'pending' ? 'Verifying...' : 'Verify audit chain'}
      </button>
      {result !== null ? (
        <section>
          <h2>Verification result</h2>
          <p>Status: {result.status}</p>
          <p>Checked: {result.checkedCount}</p>
          <p>Last sequence: {result.lastSequence}</p>
          <p>Head hash: {result.headHash}</p>
          {result.firstFailure !== undefined ? (
            <p>
              First failure: sequence {result.firstFailure.sequence} ({result.firstFailure.kind})
            </p>
          ) : null}
        </section>
      ) : null}
      {error !== null ? <p role="alert">{error}</p> : null}
    </div>
  );
}