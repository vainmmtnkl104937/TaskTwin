import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { RunDetailControls } from '@/components/workflow-runs/run-detail-controls';
import { WorkflowRunStatusBadge } from '@/components/workflow-runs/workflow-run-status-badge';
import { getAccessToken } from '@/lib/server/auth-session';
import { ControlPlaneError, getWorkflowRun } from '@/lib/server/control-plane';

export default async function WorkflowRunDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; runId: string }>;
}) {
  const { workspaceId, runId } = await params;
  const token = await getAccessToken();
  if (token === null) {
    redirect('/login');
  }
  let result;
  try {
    result = await getWorkflowRun(token, runId);
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError && error.status === 404) {
      notFound();
    }
    throw error;
  }
  if (result.run.workspaceId !== workspaceId) {
    notFound();
  }
  return (
    <main className="dashboard-page">
      <nav aria-label="Breadcrumb">
        <Link href={`/workspaces/${workspaceId}/runs`}>Workflow runs</Link>
      </nav>
      <section className="page-heading">
        <p className="eyebrow">Persisted execution</p>
        <h1>Run detail</h1>
        <p>
          <WorkflowRunStatusBadge status={result.run.status} /> · Version{' '}
          {result.run.workflowVersion}
        </p>
        <RunDetailControls
          workspaceId={workspaceId}
          runId={runId}
          status={result.run.status}
          canCancel={result.access.canCancel}
        />
      </section>
      <section className="workflow-list" aria-label="Workflow run steps">
        {result.run.steps.map((step) => (
          <article className="panel workflow-list-item" key={step.stepId}>
            <div>
              <h2>
                {step.stepIndex + 1}. {step.stepId}
              </h2>
              <p className="metadata">
                {step.stepType} · {step.status}
                {step.errorCode === null ? '' : ` · ${step.errorCode}`}
              </p>
              {step.verification === undefined ? null : (
                <p className="metadata">
                  Verification: {step.verification.kind} ·{' '}
                  {step.verification.outcome} · attempts{' '}
                  {step.verification.attemptCount}
                  {step.verification.observedState === undefined
                    ? ''
                    : ` · ${step.verification.observedState}`}
                </p>
              )}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
