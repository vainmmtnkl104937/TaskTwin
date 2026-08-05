import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAccessToken } from '@/lib/server/auth-session';
import {
  getExecutionPolicy,
  listExecutionPolicyVersions,
} from '@/lib/server/control-plane';

import { updateExecutionPolicy } from './actions';

function originLines(patterns: Array<{ kind: string; origin?: string; domain?: string }>) {
  return patterns
    .map((pattern) =>
      pattern.kind === 'exact' ? pattern.origin : `*.${pattern.domain}`,
    )
    .join('\n');
}

export default async function ExecutionPolicyPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const token = await getAccessToken();
  if (token === null) redirect('/login');
  const [result, history] = await Promise.all([
    getExecutionPolicy(token, workspaceId),
    listExecutionPolicyVersions(token, workspaceId),
  ]);
  const policy = result.active.definition;
  return (
    <main className="dashboard-page">
      <nav aria-label="Breadcrumb"><Link href="/workspaces">Workspaces</Link></nav>
      <section className="page-heading">
        <p className="eyebrow">Deterministic execution safety</p>
        <h1>Execution Policy</h1>
        <p>Active revision {result.active.revision} · Role: {result.access.role}</p>
      </section>
      <form action={updateExecutionPolicy} className="panel editor-form">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="expectedActiveRevision" value={result.active.revision} />
        <label>Network policy
          <select name="networkMode" defaultValue={policy.network.mode} disabled={!result.access.canEdit}>
            <option value="workflow_declared_origins">Workflow-declared origins</option>
            <option value="explicit_allowlist">Explicit allowlist</option>
          </select>
        </label>
        <label>Allowed origins (one exact origin per line)
          <textarea name="allowedOrigins" defaultValue={originLines(policy.network.allowedOrigins)} disabled={!result.access.canEdit} />
        </label>
        <label>Blocked origins (one exact origin per line)
          <textarea name="blockedOrigins" defaultValue={originLines(policy.network.blockedOrigins)} disabled={!result.access.canEdit} />
        </label>
        <label><input type="checkbox" name="allowLoopbackHttp" defaultChecked={policy.network.allowLoopbackHttp} disabled={!result.access.canEdit} /> Allow local HTTP loopback</label>
        <label>Unknown-action risk
          <select name="unknownActionRisk" defaultValue={policy.unknownActionRisk} disabled={!result.access.canEdit}>
            <option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
          </select>
        </label>
        <label>Approval threshold
          <select name="approvalThreshold" defaultValue={policy.approval.threshold} disabled={!result.access.canEdit}>
            <option value="high_or_above">High or above</option><option value="critical_only">Critical only</option>
          </select>
        </label>
        <label>Critical actions
          <select name="criticalActionBehavior" defaultValue={policy.approval.criticalActionBehavior} disabled={!result.access.canEdit}>
            <option value="deny">Deny</option><option value="require_approval">Require approval</option>
          </select>
        </label>
        <section aria-label="Action rules"><h2>Action rules</h2>{policy.rules.length === 0 ? <p>No custom rules.</p> : <ul>{policy.rules.map((rule) => <li key={rule.id}>{rule.id}</li>)}</ul>}</section>
        {result.access.canEdit ? <button type="submit">Activate new revision</button> : <p>This policy is read-only for your role.</p>}
      </form>
      <section className="panel"><h2>Version history</h2><ul>{history.versions.map((version) => <li key={version.id}>Revision {version.revision} · {version.status}</li>)}</ul></section>
    </main>
  );
}
