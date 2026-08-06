import type { JSX } from 'react';

interface ApprovalPayload {
  schemaVersion: number;
  approvalRequestId: string;
  workflowRunId: string;
  decision?: string;
  decidedByUserId?: string;
}

export function ApprovalPayloadView({ payload }: { payload: unknown }): JSX.Element {
  const data = payload as ApprovalPayload;
  return (
    <ul>
      <li>approvalRequestId: {data.approvalRequestId}</li>
      <li>workflowRunId: {data.workflowRunId}</li>
      {data.decision !== undefined ? <li>decision: {data.decision}</li> : null}
      {data.decidedByUserId !== undefined ? (
        <li>decidedByUserId: {data.decidedByUserId}</li>
      ) : null}
    </ul>
  );
}
