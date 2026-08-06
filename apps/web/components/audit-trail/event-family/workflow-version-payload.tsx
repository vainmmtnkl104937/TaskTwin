import type { JSX } from 'react';

interface WorkflowVersionPayload {
  schemaVersion: number;
  workflowId: string;
  workflowVersionId: string;
  versionNumber: number;
  supersededByVersionId?: string;
  supersededVersionId?: string;
}

export function WorkflowVersionPayloadView({
  payload,
}: {
  payload: unknown;
}): JSX.Element {
  const data = payload as WorkflowVersionPayload;
  return (
    <ul>
      <li>workflowId: {data.workflowId}</li>
      <li>workflowVersionId: {data.workflowVersionId}</li>
      <li>versionNumber: {data.versionNumber}</li>
      {data.supersededByVersionId !== undefined ? (
        <li>supersededByVersionId: {data.supersededByVersionId}</li>
      ) : null}
      {data.supersededVersionId !== undefined ? (
        <li>supersededVersionId: {data.supersededVersionId}</li>
      ) : null}
    </ul>
  );
}
