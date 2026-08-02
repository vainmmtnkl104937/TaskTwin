'use client';

import { useTransition } from 'react';

import { decideRepairAction } from './actions';

export function RepairDecisionButtons(props: {
  workspaceId: string;
  repairRequestId: string;
  canRetry: boolean;
  canAbort: boolean;
  retryAllowed: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const decide = (decision: 'retry' | 'abort') => {
    const confirmed = window.confirm(
      decision === 'retry'
        ? 'Retry only this failed step in the existing browser session?'
        : 'Abort this workflow run and close its browser session?',
    );
    if (!confirmed) return;
    startTransition(() =>
      decideRepairAction({
        workspaceId: props.workspaceId,
        repairRequestId: props.repairRequestId,
        decision,
      }),
    );
  };
  return (
    <div className="step-actions" aria-label="Repair decision">
      {props.canRetry ? (
        <button
          type="button"
          disabled={pending || !props.retryAllowed}
          onClick={() => decide('retry')}
        >
          Retry step
        </button>
      ) : null}
      {props.canAbort ? (
        <button
          type="button"
          className="secondary-button"
          disabled={pending}
          onClick={() => decide('abort')}
        >
          Abort run
        </button>
      ) : null}
    </div>
  );
}
