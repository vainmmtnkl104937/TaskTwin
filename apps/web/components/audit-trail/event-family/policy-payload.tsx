import type { JSX } from 'react';

interface PolicyPayload {
  schemaVersion: number;
  policyId: string;
  policyVersionId: string;
  versionNumber: number;
  supersededByVersionId?: string;
  supersededVersionId?: string;
}

export function PolicyPayloadView({ payload }: { payload: unknown }): JSX.Element {
  const data = payload as PolicyPayload;
  return (
    <ul>
      <li>policyId: {data.policyId}</li>
      <li>policyVersionId: {data.policyVersionId}</li>
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
