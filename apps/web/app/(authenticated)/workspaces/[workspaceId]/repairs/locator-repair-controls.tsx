'use client';

import { useState, useTransition } from 'react';

import { applyLocatorRepairAction, requestLocatorTestAction } from './actions';

export function LocatorRepairControls({
  workspaceId,
  proposalId,
  candidateId,
  testStatus,
  canTest,
  canApply,
}: {
  workspaceId: string;
  proposalId: string;
  candidateId: string;
  testStatus: string;
  canTest: boolean;
  canApply: boolean;
}) {
  const [draftId, setDraftId] = useState('');
  const [revision, setRevision] = useState('1');
  const [pending, startTransition] = useTransition();
  return (
    <div className="button-row">
      {testStatus === 'NOT_REQUESTED' ? (
        <button
          disabled={!canTest || pending}
          onClick={() =>
            startTransition(() =>
              requestLocatorTestAction({ workspaceId, candidateId }),
            )
          }
        >
          Test candidate
        </button>
      ) : null}
      {testStatus === 'PASSED' ? (
        <>
          <label>
            Target Draft version ID
            <input
              value={draftId}
              onChange={(event) => setDraftId(event.target.value)}
            />
          </label>
          <label>
            Expected revision
            <input
              type="number"
              min="1"
              value={revision}
              onChange={(event) => setRevision(event.target.value)}
            />
          </label>
          <button
            disabled={!canApply || pending || draftId === ''}
            onClick={() =>
              startTransition(() =>
                applyLocatorRepairAction({
                  workspaceId,
                  proposalId,
                  candidateId,
                  targetDraftVersionId: draftId,
                  expectedRevision: Number(revision),
                }),
              )
            }
          >
            Apply to existing Draft
          </button>
        </>
      ) : null}
    </div>
  );
}
