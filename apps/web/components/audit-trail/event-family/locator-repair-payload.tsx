import type { JSX } from 'react';

interface LocatorRepairPayload {
  schemaVersion: number;
  locatorRepairProposalId: string;
  workflowVersionId: string;
  candidateId: string;
}

export function LocatorRepairPayloadView({
  payload,
}: {
  payload: unknown;
}): JSX.Element {
  const data = payload as LocatorRepairPayload;
  return (
    <ul>
      <li>locatorRepairProposalId: {data.locatorRepairProposalId}</li>
      <li>workflowVersionId: {data.workflowVersionId}</li>
      <li>candidateId: {data.candidateId}</li>
    </ul>
  );
}
