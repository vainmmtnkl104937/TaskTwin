import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ScheduleStatusBadge } from '@/components/schedules/schedule-status-badge';
import { OccurrenceStatusBadge } from '@/components/schedules/schedule-status-badge';
import { ScheduleDetailControls } from '@/components/schedules/schedule-detail-controls';
import { WorkspaceNav } from '@/components/workspace-nav';
import { getAccessToken } from '@/lib/server/auth-session';
import {
  ControlPlaneError,
  getWorkflowSchedule,
  listScheduleOccurrences,
} from '@/lib/server/control-plane';
import { ScheduleDefinitionSchema } from '@/lib/schedule-contracts';
import type { WorkflowScheduleOccurrenceRecord } from '@/lib/control-plane-contracts';

function formatDateTime(isoString: string | null): string {
  if (isoString === null) return '—';
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatDefinitionInfo(
  schedule: { definition: unknown; definitionDigest: string },
): {
  type: string;
  description: string;
  timezone: string;
  interval: string;
} {
  const def = ScheduleDefinitionSchema.safeParse(schedule.definition);
  if (!def.success) {
    return {
      type: 'Unknown',
      description: 'Invalid definition',
      timezone: '—',
      interval: '—',
    };
  }
  switch (def.data.type) {
    case 'one_time': {
      const dt = new Date(`${def.data.date}T${def.data.time}`);
      return {
        type: 'One-time',
        description: `Fires once on ${dt.toLocaleDateString(undefined, {
          dateStyle: 'long',
        })} at ${def.data.time} (${def.data.timezone})`,
        timezone: def.data.timezone,
        interval: 'Single occurrence',
      };
    }
    case 'daily': {
      const interval =
        def.data.intervalDays === 1 ? 'Daily' : `Every ${def.data.intervalDays} days`;
      let desc = `${interval} at ${def.data.time} (${def.data.timezone})`;
      if (def.data.endDate) {
        desc += ` until ${def.data.endDate}`;
      }
      return {
        type: 'Daily',
        description: desc,
        timezone: def.data.timezone,
        interval: `${def.data.intervalDays}-day interval`,
      };
    }
    case 'weekly': {
      const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const days = def.data.weekdays.map((d: number) => weekdayNames[d - 1]).join(', ');
      const interval =
        def.data.intervalWeeks === 1 ? 'Weekly' : `Every ${def.data.intervalWeeks} weeks`;
      let desc = `${interval} on ${days} at ${def.data.time} (${def.data.timezone})`;
      if (def.data.endDate) {
        desc += ` until ${def.data.endDate}`;
      }
      return {
        type: 'Weekly',
        description: desc,
        timezone: def.data.timezone,
        interval: `${def.data.intervalWeeks}-week interval`,
      };
    }
    default: {
      return {
        type: 'Unknown',
        description: 'Unknown schedule type',
        timezone: '—',
        interval: '—',
      };
    }
  }
}

function OccurrenceRow({
  occurrence,
  workspaceId,
}: {
  occurrence: WorkflowScheduleOccurrenceRecord;
  workspaceId: string;
}) {
  return (
    <article className="panel workflow-list-item">
      <div>
        <p className="metadata">
          Scheduled for: {formatDateTime(occurrence.scheduledFor)}
        </p>
        <p className="metadata">
          <OccurrenceStatusBadge status={occurrence.status} />
          {occurrence.skipReason ? ` · Skipped: ${occurrence.skipReason}` : null}
          {occurrence.terminationCause
            ? ` · Terminated: ${occurrence.terminationCause}`
            : null}
        </p>
        {occurrence.workflowRunId ? (
          <Link
            href={`/workspaces/${workspaceId}/runs/${occurrence.workflowRunId}`}
            className="button-link"
            style={{ marginTop: '0.25rem' }}
          >
            View run
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export default async function ScheduleDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; scheduleId: string }>;
}) {
  const { workspaceId, scheduleId } = await params;
  const token = await getAccessToken();
  if (token === null) {
    redirect('/login');
  }

  let scheduleResult;
  try {
    scheduleResult = await getWorkflowSchedule(token, scheduleId);
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  if (scheduleResult.workspaceId !== workspaceId) {
    notFound();
  }

  let occurrences: WorkflowScheduleOccurrenceRecord[] = [];
  try {
    const occResult = await listScheduleOccurrences(token, scheduleId, 50);
    occurrences = occResult.occurrences;
  } catch {
    // Non-fatal - just show empty occurrences
  }

  const schedule = scheduleResult.schedule;
  const defInfo = formatDefinitionInfo(schedule);

  return (
    <main className="dashboard-page">
      <WorkspaceNav workspaceId={workspaceId} currentPage="schedules" />
      <section className="page-heading">
        <p className="eyebrow">Scheduled execution</p>
        <h1>{schedule.name}</h1>
        <p>
          <ScheduleStatusBadge status={schedule.status} /> · Version{' '}
          {schedule.workflowVersion} · Created{' '}
          {formatDateTime(schedule.createdAt)}
        </p>
        <ScheduleDetailControls
          scheduleId={scheduleId}
          status={schedule.status}
          canEdit={scheduleResult.access.canEdit}
        />
      </section>

      <section className="panel workflow-metadata">
        <div>
          <h2>Schedule definition</h2>
          <p>{defInfo.description}</p>
        </div>
        <div>
          <h2>Policy</h2>
          <p className="metadata">
            Overlap: {schedule.overlapPolicy} · Misfire: {schedule.misfirePolicy} · Max
            delay: {schedule.maxStartDelaySeconds}s
          </p>
        </div>
        <div>
          <h2>Occurrences</h2>
          <p className="metadata">
            Next: {formatDateTime(schedule.nextOccurrenceAt)} · Last:{' '}
            {formatDateTime(schedule.lastOccurrenceAt)}
          </p>
        </div>
        {schedule.autoPauseReason ? (
          <div>
            <h2>Auto-pause reason</h2>
            <p className="metadata">{schedule.autoPauseReason}</p>
          </div>
        ) : null}
      </section>

      <section className="workflow-list" aria-label="Occurrence history">
        <div className="section-heading">
          <p className="eyebrow">Scheduled occurrences</p>
          <h2>Occurrence history</h2>
        </div>
        {occurrences.length === 0 ? (
          <p className="empty-state">No occurrences have been scheduled yet.</p>
        ) : (
          occurrences.map((occ) => (
            <OccurrenceRow
              key={occ.id}
              occurrence={occ}
              workspaceId={workspaceId}
            />
          ))
        )}
      </section>
    </main>
  );
}
