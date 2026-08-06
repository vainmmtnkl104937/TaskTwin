import type { JSX } from 'react';

interface RepairPayload {
  schemaVersion: number;
  repairRequestId: string;
  workflowRunId: string;
  decision?: string;
  patchId?: string;
}

export function RepairPayloadView({ payload }: { payload: unknown }): JSX.Element {
  const data = payload as RepairPayload;
  return (
    <ul>
      <li>repairRequestId: {data.repairRequestId}</li>
      <li>workflowRunId: {data.workflowRunId}</li>
      {data.decision !== undefined ? <li>decision: {data.decision}</li> : null}
      {data.patchId !== undefined ? <li>patchId: {data.patchId}</li> : null}
    </ul>
  );
}
