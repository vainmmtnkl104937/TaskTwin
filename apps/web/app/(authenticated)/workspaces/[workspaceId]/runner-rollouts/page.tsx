import Link from 'next/link';
import { redirect } from 'next/navigation';

import { WorkspaceNav } from '@/components/workspace-nav';
import { getAccessToken } from '@/lib/server/auth-session';
import {
  listRunnerDevices,
  listRunnerReleases,
  listRunnerRollouts,
} from '@/lib/server/control-plane';

import { createRolloutAction } from './actions';

export default async function RunnerRolloutsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const token = await getAccessToken();
  if (token === null) redirect('/login');
  const [result, releases, fleet] = await Promise.all([
    listRunnerRollouts(token, workspaceId),
    listRunnerReleases(token),
    listRunnerDevices(token, workspaceId),
  ]);
  const canManage =
    result.access.role === 'OWNER' || result.access.role === 'ADMIN';
  return (
    <main className="dashboard-page">
      <Link href="/workspaces">Workspaces</Link>
      <WorkspaceNav workspaceId={workspaceId} currentPage="rollouts" />
      <section className="page-heading">
        <p className="eyebrow">Human-controlled progression</p>
        <h1>Runner Release Rollouts</h1>
        <p>
          Each stage has explicit Runner membership and is activated manually.
        </p>
      </section>
      {canManage ? (
        <form action={createRolloutAction} className="panel form-stack">
          <h2>Create three-stage rollout</h2>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <label>
            Available target release
            <select name="targetReleaseId" required>
              {releases
                .filter((release) => release.status === 'available')
                .map((release) => (
                  <option key={release.id} value={release.id}>
                    {release.version}
                  </option>
                ))}
            </select>
          </label>
          {[1, 2, 3].map((number) => (
            <label key={number}>
              Stage {number} Runner IDs (comma-separated)
              <textarea name={`stage${number}`} rows={2} />
            </label>
          ))}
          <p className="metadata">
            Paired IDs:{' '}
            {fleet.devices.map((runner) => runner.id).join(', ') || 'none'}
          </p>
          <button type="submit">Create draft rollout</button>
        </form>
      ) : null}
      <section className="workflow-list" aria-label="Runner rollouts">
        {result.rollouts.map((rollout) => (
          <article className="panel workflow-list-item" key={rollout.id}>
            <h2>Target {rollout.targetRelease.version}</h2>
            <p>Status: {rollout.status.replaceAll('_', ' ')}</p>
            <p>
              {rollout.stages.length} stages ·{' '}
              {rollout.stages.reduce(
                (count, stage) => count + stage.assignments.length,
                0,
              )}{' '}
              explicit assignments
            </p>
            <Link
              href={`/workspaces/${workspaceId}/runner-rollouts/${rollout.id}`}
            >
              Review rollout
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
