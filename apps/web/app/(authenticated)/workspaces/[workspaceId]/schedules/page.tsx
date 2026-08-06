import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ScheduleStatusBadge } from '@/components/schedules/schedule-status-badge';
import { CreateScheduleDialog } from '@/components/schedules/create-schedule-dialog';
import { WorkspaceNav } from '@/components/workspace-nav';
import { getAccessToken } from '@/lib/server/auth-session';
import { ControlPlaneError, listWorkflowSchedules } from '@/lib/server/control-plane';
import type { WorkflowScheduleRecord } from '@/lib/control-plane-contracts';
import { ScheduleDefinitionSchema } from '@/lib/schedule-contracts';

function formatDateTime(isoString: string | null): string {
  if (isoString === null) return '—';
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function parseAndFormatDefinition(
  schedule: WorkflowScheduleRecord,
): { type: string; description: string; timezone: string } {
  const def = ScheduleDefinitionSchema.safeParse(schedule.definition);
  if (!def.success) {
    return { type: 'Unknown', description: 'Invalid definition', timezone: '—' };
  }
  switch (def.data.type) {
    case 'one_time': {
      const dt = new Date(`${def.data.date}T${def.data.time}`);
      return {
        type: 'One-time',
        description: `Fires once on ${dt.toLocaleDateString(undefined, { dateStyle: 'long' })} at ${def.data.time}`,
        timezone: def.data.timezone,
      };
    }
    case 'daily': {
      const interval = def.data.intervalDays === 1 ? 'Daily' : `Every ${def.data.intervalDays} days`;
      let desc = `${interval} at ${def.data.time}`;
      if (def.data.endDate) {
        desc += ` until ${def.data.endDate}`;
      }
      return { type: 'Daily', description: desc, timezone: def.data.timezone };
    }
    case 'weekly': {
      const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const days = def.data.weekdays.map((d: number) => weekdayNames[d - 1]).join(', ');
      const interval = def.data.intervalWeeks === 1 ? 'Weekly' : `Every ${def.data.intervalWeeks} weeks`;
      let desc = `${interval} on ${days} at ${def.data.time}`;
      if (def.data.endDate) {
        desc += ` until ${def.data.endDate}`;
      }
      return { type: 'Weekly', description: desc, timezone: def.data.timezone };
    }
    default: {
      return { type: 'Unknown', description: 'Unknown schedule type', timezone: '—' };
    }
  }
}

export default async function SchedulesPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const accessToken = await getAccessToken();
  if (accessToken === null) {
    redirect('/login');
  }

  let result;
  try {
    result = await listWorkflowSchedules(accessToken, workspaceId);
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError && error.status === 401) {
      redirect('/auth/expired');
    }
    throw error;
  }

  return (
    <main className="dashboard-page">
      <WorkspaceNav workspaceId={workspaceId} currentPage="schedules" />
      <section className="page-heading">
        <p className="eyebrow">Scheduled execution</p>
        <h1>Schedules</h1>
        <p>
          Role: {result.access.role}.{' '}
          {result.access.canEdit ? 'You can create and manage schedules.' : 'Read only.'}
        </p>
        {result.access.canEdit && (
          <CreateScheduleDialog workspaceId={workspaceId} />
        )}
      </section>
      <section className="workflow-list" aria-label="Workflow schedules">
        {result.schedules.map((schedule) => {
          const defInfo = parseAndFormatDefinition(schedule);
          return (
            <article className="panel workflow-list-item" key={schedule.id}>
              <div>
                <h2>{schedule.name}</h2>
                <p>{defInfo.description}</p>
                <p className="metadata">
                  <ScheduleStatusBadge status={schedule.status} /> · {defInfo.type} ·{' '}
                  {defInfo.timezone} · Next: {formatDateTime(schedule.nextOccurrenceAt)}
                </p>
              </div>
              <div className="button-group">
                <Link
                  className="button-link"
                  href={`/workspaces/${workspaceId}/schedules/${encodeURIComponent(schedule.id)}`}
                >
                  View details
                </Link>
              </div>
            </article>
          );
        })}
        {result.schedules.length === 0 ? (
          <p className="empty-state">No schedules exist yet. Create one to get started.</p>
        ) : null}
      </section>
    </main>
  );
}
