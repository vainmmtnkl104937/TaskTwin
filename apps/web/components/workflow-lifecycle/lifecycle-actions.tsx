'use client';

import type { PublishReadinessReport } from '@tasktwin/workflow-lifecycle';
import type { WorkflowLifecycleStatus } from '@tasktwin/workflow-schema';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  archiveVersionAction,
  publishVersionAction,
  returnToDraftAction,
  submitForTestingAction,
  type WorkflowLifecycleActionResult,
} from '@/app/(authenticated)/workspaces/[workspaceId]/workflows/[workflowId]/versions/actions';

import { CreateDraftButton } from './create-draft-button';

export function LifecycleActions({
  workflowId,
  workspaceId,
  versionId,
  revision,
  status,
  canEdit,
  canPublish,
  dirty,
  readiness,
}: {
  workflowId: string;
  workspaceId: string;
  versionId: string;
  revision: number;
  status: WorkflowLifecycleStatus;
  canEdit: boolean;
  canPublish: boolean;
  dirty: boolean;
  readiness: PublishReadinessReport;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  async function run(
    operation: () => Promise<WorkflowLifecycleActionResult>,
  ): Promise<void> {
    setPending(true);
    setMessage('');
    const result = await operation();
    setPending(false);
    if (result.status === 'success') {
      router.refresh();
      return;
    }
    setMessage(result.message);
  }

  function confirmPublish(): void {
    const warningCount = readiness.summary.warningCount;
    const warningText =
      warningCount === 0
        ? 'No readiness warnings were reported.'
        : `${warningCount} readiness warning(s) remain.`;
    if (
      window.confirm(`Publish this immutable workflow version? ${warningText}`)
    ) {
      void run(() => publishVersionAction(versionId, revision));
    }
  }

  return (
    <section
      className="lifecycle-actions"
      aria-label="Version lifecycle actions"
    >
      <div className="button-group">
        {status === 'draft' && canEdit ? (
          <button
            type="button"
            disabled={pending || dirty || !readiness.ready}
            title={
              dirty
                ? 'Save your Draft before submitting it.'
                : readiness.ready
                  ? undefined
                  : 'Resolve blocking readiness issues first.'
            }
            onClick={() =>
              void run(() => submitForTestingAction(versionId, revision))
            }
          >
            Submit for Testing
          </button>
        ) : null}
        {status === 'testing' && canEdit ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              void run(() => returnToDraftAction(versionId, revision))
            }
          >
            Return to Draft
          </button>
        ) : null}
        {status === 'testing' && canPublish ? (
          <button
            type="button"
            disabled={pending || !readiness.ready}
            onClick={confirmPublish}
          >
            Publish
          </button>
        ) : null}
        {status === 'published' && canPublish ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm('Archive this Published version?')) {
                void run(() => archiveVersionAction(versionId));
              }
            }}
          >
            Archive
          </button>
        ) : null}
        {(status === 'published' || status === 'archived') && canEdit ? (
          <CreateDraftButton
            workflowId={workflowId}
            workspaceId={workspaceId}
            sourceVersionId={versionId}
          />
        ) : null}
      </div>
      {dirty && status === 'draft' ? (
        <p className="metadata">Save local changes before changing status.</p>
      ) : null}
      {message === '' ? null : (
        <p className="error-banner" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
