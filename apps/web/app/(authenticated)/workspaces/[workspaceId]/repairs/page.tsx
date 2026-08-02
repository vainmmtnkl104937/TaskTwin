import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAccessToken } from '@/lib/server/auth-session';
import { listRepairRequests } from '@/lib/server/control-plane';

import { RepairDecisionButtons } from './repair-decision-buttons';

const effectDescription = {
  not_started: 'The browser action is known not to have started.',
  read_only: 'The failed operation was read-only.',
  side_effect_possible: 'A browser side effect may already have happened.',
  completed: 'The operation completed and cannot be repeated safely.',
  unknown: 'The effect is uncertain, so retry is prohibited.',
} as const;

export default async function RepairCenterPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const token = await getAccessToken();
  if (token === null) redirect('/login');
  const result = await listRepairRequests(token, workspaceId);
  return (
    <main className="dashboard-page">
      <nav aria-label="Breadcrumb">
        <Link href={`/workspaces/${workspaceId}/runs`}>Workflow runs</Link>
      </nav>
      <section className="page-heading">
        <p className="eyebrow">Attended recovery</p>
        <h1>Repair Center</h1>
        <p>
          Manual browser changes are not fully audited. Retry repeats only the
          failed step and is unavailable when a side effect is possible.
        </p>
      </section>
      <section className="workflow-list" aria-label="Repair requests">
        {result.requests.map((request) => (
          <article className="panel workflow-list-item" key={request.id}>
            <div>
              <h2>{request.workflowName}</h2>
              <p className="metadata">
                Version {request.workflowVersion} · {request.status} · Runner{' '}
                {request.runner.name}
              </p>
              <p>
                Step {request.step.index + 1}: {request.step.name} (
                {request.step.type})
              </p>
              <p className="metadata">
                Attempt {request.attemptNumber} · {request.safeErrorCode}
              </p>
              <p>{effectDescription[request.effectCertainty]}</p>
              <p className="metadata">
                Expires: {new Date(request.expiresAt).toLocaleString()}
              </p>
              <Link href={`/workspaces/${workspaceId}/repairs/${request.id}`}>
                View repair
              </Link>
            </div>
            {request.status === 'PENDING' ? (
              <RepairDecisionButtons
                workspaceId={workspaceId}
                repairRequestId={request.id}
                canRetry={result.access.canRetry}
                canAbort={result.access.canAbort}
                retryAllowed={request.retryAllowed}
              />
            ) : null}
          </article>
        ))}
        {result.requests.length === 0 ? (
          <p className="empty-state">No repair request exists.</p>
        ) : null}
      </section>
    </main>
  );
}
