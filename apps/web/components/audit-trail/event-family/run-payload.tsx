import type { JSX } from 'react';

interface RunPayload {
  schemaVersion: number;
  workflowRunId: string;
  workflowVersionId: string;
  attempt?: number;
  outcome?: string;
  reason?: string;
}

export function RunPayloadView({ payload }: { payload: unknown }): JSX.Element {
  const data = payload as RunPayload;
  return (
    <ul>
      <li>workflowRunId: {data.workflowRunId}</li>
      <li>workflowVersionId: {data.workflowVersionId}</li>
      {data.attempt !== undefined ? <li>attempt: {data.attempt}</li> : null}
      {data.outcome !== undefined ? <li>outcome: {data.outcome}</li> : null}
      {data.reason !== undefined ? <li>reason: {data.reason}</li> : null}
    </ul>
  );
}
