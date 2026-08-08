import { redirect } from 'next/navigation';
import { MetricWindowSchema } from '@tasktwin/operational-telemetry';

import { OperationsDashboard } from '@/components/operations/operations-dashboard';
import { WorkspaceNav } from '@/components/workspace-nav';
import { getAccessToken } from '@/lib/server/auth-session';
import { getWorkspaceOperations } from '@/lib/server/control-plane';

export default async function OperationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ window?: string | string[] }>;
}) {
  const { workspaceId } = await params;
  const token = await getAccessToken();
  if (token === null) redirect('/login');
  const query = await searchParams;
  const rawWindow = Array.isArray(query.window)
    ? query.window[0]
    : query.window;
  const parsedWindow = MetricWindowSchema.safeParse(rawWindow ?? '24h');
  if (!parsedWindow.success)
    redirect(`/workspaces/${workspaceId}/operations?window=24h`);
  const snapshot = await getWorkspaceOperations(
    token,
    workspaceId,
    parsedWindow.data,
  );

  return (
    <main className="dashboard-page">
      <WorkspaceNav workspaceId={workspaceId} currentPage="operations" />
      <section className="page-heading">
        <p className="eyebrow">Privacy-safe telemetry</p>
        <h1>Workspace Operations</h1>
        <p>
          Health, capacity and recent outcomes without workflow runtime data.
        </p>
      </section>
      <OperationsDashboard workspaceId={workspaceId} snapshot={snapshot} />
    </main>
  );
}
