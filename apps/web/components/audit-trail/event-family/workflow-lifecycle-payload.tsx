import type { JSX } from 'react';

interface WorkflowLifecyclePayload {
  schemaVersion: number;
  workflowId: string;
  workflowName?: string;
}

export function WorkflowLifecyclePayloadView({
  payload,
}: {
  payload: unknown;
}): JSX.Element {
  const data = payload as WorkflowLifecyclePayload;
  return (
    <ul>
      <li>workflowId: {data.workflowId}</li>
      {data.workflowName !== undefined ? <li>workflowName: {data.workflowName}</li> : null}
    </ul>
  );
}
