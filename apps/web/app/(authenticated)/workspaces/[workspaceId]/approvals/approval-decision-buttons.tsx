'use client';

import { useTransition } from 'react';

import { decideApprovalAction } from './actions';

export function ApprovalDecisionButtons({
  workspaceId,
  approvalRequestId,
}: {
  workspaceId: string;
  approvalRequestId: string;
}) {
  const [pending, startTransition] = useTransition();
  const decide = (decision: 'approve' | 'reject') => {
    const confirmed = window.confirm(
      decision === 'approve'
        ? 'Approve the immediate next workflow step?'
        : 'Reject this request and cancel the workflow run?',
    );
    if (!confirmed) return;
    startTransition(() =>
      decideApprovalAction({ workspaceId, approvalRequestId, decision }),
    );
  };
  return (
    <div className="step-actions" aria-label="Approval decision">
      <button
        type="button"
        disabled={pending}
        onClick={() => decide('approve')}
      >
        Approve
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={pending}
        onClick={() => decide('reject')}
      >
        Reject
      </button>
    </div>
  );
}
