'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { createDraftVersionAction } from '@/app/(authenticated)/workspaces/[workspaceId]/workflows/[workflowId]/versions/actions';

export function CreateDraftButton({
  workflowId,
  workspaceId,
  sourceVersionId,
}: {
  workflowId: string;
  workspaceId: string;
  sourceVersionId: string;
}) {
  const router = useRouter();
  const creationId = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  async function createDraft(): Promise<void> {
    if (
      !window.confirm(
        'Create a new editable Draft from this immutable version?',
      )
    ) {
      return;
    }

    creationId.current ??= crypto.randomUUID();
    setPending(true);
    setMessage('');
    const result = await createDraftVersionAction(
      workflowId,
      sourceVersionId,
      creationId.current,
    );
    if (result.status === 'success') {
      creationId.current = null;
      router.push(
        `/workspaces/${workspaceId}/workflows/${encodeURIComponent(workflowId)}/versions/${result.versionId}/edit`,
      );
      return;
    }
    setPending(false);
    setMessage(result.message);
  }

  return (
    <span className="inline-action">
      <button
        type="button"
        disabled={pending}
        onClick={() => void createDraft()}
      >
        {pending ? 'Creating…' : 'Create new Draft'}
      </button>
      {message === '' ? null : (
        <span className="inline-error" role="status">
          {message}
        </span>
      )}
    </span>
  );
}
