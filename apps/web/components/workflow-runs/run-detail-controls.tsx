'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { cancelWorkflowRunAction } from '@/app/(authenticated)/workspaces/[workspaceId]/runs/actions';

const TERMINAL = new Set([
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
  'INTERRUPTED',
]);

export function RunDetailControls({
  workspaceId,
  runId,
  status,
  canCancel,
}: {
  workspaceId: string;
  runId: string;
  status: string;
  canCancel: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (TERMINAL.has(status)) {
      return;
    }
    const timer = window.setInterval(() => router.refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [router, status]);

  async function cancel() {
    const result = await cancelWorkflowRunAction(workspaceId, runId);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="button-group">
      <button
        disabled={!canCancel || TERMINAL.has(status)}
        onClick={cancel}
        className="danger-button"
      >
        Cancel run
      </button>
      {message === '' ? null : <p className="inline-error">{message}</p>}
    </div>
  );
}
