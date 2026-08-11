import Link from 'next/link';
import { redirect } from 'next/navigation';

import { WorkspaceNav } from '@/components/workspace-nav';
import { getAccessToken } from '@/lib/server/auth-session';
import { getRunnerRollout } from '@/lib/server/control-plane';

import { activateStageAction, rolloutAction } from '../actions';

export default async function RunnerRolloutDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; rolloutId: string }>;
}) {
  const { workspaceId, rolloutId } = await params;
  const token = await getAccessToken();
  if (token === null) redirect('/login');
  const { access, rollout } = await getRunnerRollout(token, rolloutId);
  const canManage = access.role === 'OWNER' || access.role === 'ADMIN';
  return (
    <main className="dashboard-page">
      <Link href={`/workspaces/${workspaceId}/runner-rollouts`}>Rollouts</Link>
      <WorkspaceNav workspaceId={workspaceId} currentPage="rollouts" />
      <section className="page-heading">
        <p className="eyebrow">Declarative rollout</p>
        <h1>Target {rollout.targetRelease.version}</h1>
        <p>
          Status: {words(rollout.status)} · Release:{' '}
          {words(rollout.targetRelease.status)}
        </p>
        {rollout.reviewReason ? (
          <p role="alert">Review required: {words(rollout.reviewReason)}</p>
        ) : null}
        {canManage ? (
          <div className="button-row">
            {rollout.status === 'draft' || rollout.status === 'paused' ? (
              <RolloutActionForm
                workspaceId={workspaceId}
                rolloutId={rollout.id}
                action="activate"
                label={
                  rollout.status === 'draft'
                    ? 'Activate rollout'
                    : 'Resume rollout'
                }
              />
            ) : null}
            {rollout.status === 'active' ? (
              <RolloutActionForm
                workspaceId={workspaceId}
                rolloutId={rollout.id}
                action="pause"
                label="Pause rollout"
              />
            ) : null}
            {rollout.status !== 'completed' &&
            rollout.status !== 'cancelled' ? (
              <RolloutActionForm
                workspaceId={workspaceId}
                rolloutId={rollout.id}
                action="cancel"
                label="Cancel rollout"
              />
            ) : null}
          </div>
        ) : null}
      </section>
      <section className="workflow-list" aria-label="Rollout stages">
        {rollout.stages.map((stage, index) => {
          const convergedCount = stage.assignments.filter(
            (assignment) => assignment.status === 'converged',
          ).length;
          const assignedCount = stage.assignments.filter(
            (assignment) => assignment.status === 'target_assigned',
          ).length;
          const rolledBackCount = stage.assignments.filter(
            (assignment) => assignment.status === 'rolled_back',
          ).length;
          const previousComplete =
            index === 0 || rollout.stages[index - 1]?.status === 'completed';
          const mayActivate =
            canManage &&
            rollout.status === 'active' &&
            rollout.targetRelease.status === 'available' &&
            stage.status === 'pending' &&
            previousComplete;
          return (
            <article className="panel workflow-list-item" key={stage.id}>
              <h2>Stage {stage.stageNumber}</h2>
              <p>Status: {words(stage.status)}</p>
              <p>
                Converged: {convergedCount} · Assigned: {assignedCount} · Rolled
                back: {rolledBackCount}
              </p>
              <ul>
                {stage.assignments.map((assignment) => (
                  <li key={assignment.id}>
                    {assignment.runnerDisplayName}: {words(assignment.status)}
                    {assignment.lastObservedVersion
                      ? ` (observed ${assignment.lastObservedVersion})`
                      : ''}
                  </li>
                ))}
              </ul>
              {mayActivate ? (
                <form action={activateStageAction}>
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <input type="hidden" name="rolloutId" value={rollout.id} />
                  <input
                    type="hidden"
                    name="stageNumber"
                    value={stage.stageNumber}
                  />
                  <button type="submit">
                    Activate Stage {stage.stageNumber}
                  </button>
                </form>
              ) : null}
            </article>
          );
        })}
      </section>
    </main>
  );
}

function RolloutActionForm({
  workspaceId,
  rolloutId,
  action,
  label,
}: {
  workspaceId: string;
  rolloutId: string;
  action: 'activate' | 'pause' | 'cancel';
  label: string;
}) {
  return (
    <form action={rolloutAction}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="rolloutId" value={rolloutId} />
      <input type="hidden" name="action" value={action} />
      <button type="submit">{label}</button>
    </form>
  );
}

function words(value: string): string {
  return value.replaceAll('_', ' ');
}
