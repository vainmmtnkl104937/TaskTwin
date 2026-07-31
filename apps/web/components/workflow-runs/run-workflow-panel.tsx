'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { createWorkflowRunAction } from '@/app/(authenticated)/workspaces/[workspaceId]/runs/actions';

export function RunWorkflowPanel({
  workspaceId,
  workflowVersionId,
  runners,
}: {
  workspaceId: string;
  workflowVersionId: string;
  runners: Array<{ id: string; name: string; status: string }>;
}) {
  const router = useRouter();
  const [runnerId, setRunnerId] = useState(runners[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const clientRunId = useRef<string | undefined>(undefined);

  async function run() {
    if (runnerId === '') {
      setMessage('Select a Local Runner.');
      return;
    }

    clientRunId.current ??= crypto.randomUUID();
    setPending(true);
    const result = await createWorkflowRunAction({
      workspaceId,
      workflowVersionId,
      runnerDeviceId: runnerId,
      clientRunId: clientRunId.current,
    });
    setPending(false);
    if (result.ok) {
      clientRunId.current = undefined;
      router.push(`/workspaces/${workspaceId}/runs/${result.runId}`);
    } else {
      setMessage(result.message);
    }
  }

  return (
    <div className="run-workflow-panel">
      <label>
        Local Runner
        <select
          aria-label="Local Runner"
          value={runnerId}
          onChange={(event) => setRunnerId(event.target.value)}
        >
          {runners.map((runner) => (
            <option key={runner.id} value={runner.id}>
              {runner.name} ({runner.status})
            </option>
          ))}
        </select>
      </label>
      <button disabled={pending || runners.length === 0} onClick={run}>
        {pending ? 'Creating run...' : 'Run'}
      </button>
      {message === '' ? null : <p className="inline-error">{message}</p>}
    </div>
  );
}
