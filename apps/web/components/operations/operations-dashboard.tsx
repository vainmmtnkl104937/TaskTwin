import Link from 'next/link';
import type {
  MetricWindow,
  WorkspaceOperationsSnapshot,
} from '@tasktwin/operational-telemetry';

const WINDOWS: readonly MetricWindow[] = ['1h', '24h', '7d', '30d'];

const displayRate = (value: number | null): string =>
  value === null ? 'Not available' : `${(value * 100).toFixed(1)}%`;

const displayDuration = (value: number | null): string =>
  value === null ? 'Not available' : `${Math.round(value / 1_000)}s`;

function HealthCard({
  label,
  state,
  lastSeenAt,
}: {
  label: string;
  state: string;
  lastSeenAt: string | null;
}) {
  return (
    <article className={`panel operations-card health-${state}`}>
      <h2>{label}</h2>
      <p className="operations-value">{state.replace('_', ' ')}</p>
      <p className="metadata">
        Last seen:{' '}
        {lastSeenAt === null ? 'Never' : new Date(lastSeenAt).toLocaleString()}
      </p>
    </article>
  );
}

export function OperationsDashboard({
  workspaceId,
  snapshot,
}: {
  workspaceId: string;
  snapshot: WorkspaceOperationsSnapshot;
}) {
  return (
    <>
      <nav className="operations-window" aria-label="Metric window">
        {WINDOWS.map((window) => (
          <Link
            key={window}
            href={`/workspaces/${workspaceId}/operations?window=${window}`}
            aria-current={
              snapshot.window.selected === window ? 'page' : undefined
            }
          >
            {window}
          </Link>
        ))}
      </nav>

      <section className="operations-grid" aria-label="Component health">
        <HealthCard
          label="Control Plane API"
          {...snapshot.components.controlPlaneApi}
        />
        <HealthCard label="Scheduler" {...snapshot.components.scheduler} />
        <HealthCard
          label="Notification Worker"
          {...snapshot.components.notificationWorker}
        />
      </section>

      <section
        className="operations-grid"
        aria-label="Workspace operational summaries"
      >
        <article className="panel operations-card">
          <h2>Runners</h2>
          <dl>
            <dt>Online</dt>
            <dd>{snapshot.runners.online}</dd>
            <dt>Available</dt>
            <dd>{snapshot.runners.available}</dd>
            <dt>Busy</dt>
            <dd>{snapshot.runners.busy}</dd>
            <dt>Offline</dt>
            <dd>{snapshot.runners.offline}</dd>
            <dt>Revoked</dt>
            <dd>{snapshot.runners.revoked}</dd>
          </dl>
        </article>
        <article className="panel operations-card">
          <h2>Run outcomes</h2>
          <dl>
            <dt>Succeeded</dt>
            <dd>{snapshot.runs.succeeded}</dd>
            <dt>Failed</dt>
            <dd>{snapshot.runs.failed}</dd>
            <dt>Timed out</dt>
            <dd>{snapshot.runs.timedOut}</dd>
            <dt>Interrupted</dt>
            <dd>{snapshot.runs.interrupted}</dd>
            <dt>Cancelled</dt>
            <dd>{snapshot.runs.cancelled}</dd>
            <dt>Success rate</dt>
            <dd>{displayRate(snapshot.runs.successRate)}</dd>
            <dt>Failure rate</dt>
            <dd>{displayRate(snapshot.runs.failureRate)}</dd>
            <dt>Average duration</dt>
            <dd>{displayDuration(snapshot.runs.averageTerminalDurationMs)}</dd>
          </dl>
          <Link href={`/workspaces/${workspaceId}/runs`}>View runs</Link>
        </article>
        <article className="panel operations-card">
          <h2>Pending work</h2>
          <dl>
            <dt>Approvals</dt>
            <dd>{snapshot.approvals.pending}</dd>
            <dt>Repairs</dt>
            <dd>{snapshot.repairs.pending}</dd>
            <dt>Runs active</dt>
            <dd>{snapshot.runs.currentlyActive}</dd>
            <dt>Waiting for approval</dt>
            <dd>{snapshot.runs.currentlyWaitingForApproval}</dd>
            <dt>Waiting for repair</dt>
            <dd>{snapshot.runs.currentlyWaitingForRepair}</dd>
          </dl>
          <p>
            <Link href={`/workspaces/${workspaceId}/approvals`}>Approvals</Link>
            {' · '}
            <Link href={`/workspaces/${workspaceId}/repairs`}>Repairs</Link>
          </p>
        </article>
        <article className="panel operations-card">
          <h2>Schedules</h2>
          <dl>
            <dt>Active</dt>
            <dd>{snapshot.schedules.active}</dd>
            <dt>Paused</dt>
            <dd>{snapshot.schedules.paused}</dd>
            <dt>Auto-paused</dt>
            <dd>{snapshot.schedules.autoPaused}</dd>
            <dt>Completed</dt>
            <dd>{snapshot.schedules.completed}</dd>
            <dt>Skipped occurrences</dt>
            <dd>{snapshot.schedules.skippedOccurrences}</dd>
            <dt>Timed-out occurrences</dt>
            <dd>{snapshot.schedules.timedOutOccurrences}</dd>
          </dl>
          <Link href={`/workspaces/${workspaceId}/schedules`}>
            View schedules
          </Link>
        </article>
        <article className="panel operations-card">
          <h2>Notifications</h2>
          <dl>
            <dt>Pending outbox</dt>
            <dd>{snapshot.notifications.pendingOutbox}</dd>
            <dt>Processing</dt>
            <dd>{snapshot.notifications.processingOutbox}</dd>
            <dt>Delivered</dt>
            <dd>{snapshot.notifications.delivered}</dd>
            <dt>Dead letter</dt>
            <dd>{snapshot.notifications.deadLetter}</dd>
            <dt>Active critical alerts</dt>
            <dd>{snapshot.notifications.criticalActiveAlerts}</dd>
          </dl>
          <Link href="/notifications">Notification Inbox</Link>
        </article>
        <article
          className={`panel operations-card integrity-${snapshot.auditIntegrity.status}`}
        >
          <h2>Audit integrity</h2>
          <p className="operations-value">
            {snapshot.auditIntegrity.status.replace('_', ' ')}
          </p>
          <dl>
            <dt>Chain head</dt>
            <dd>{snapshot.auditIntegrity.chainHeadSequence}</dd>
            <dt>Last verified</dt>
            <dd>
              {snapshot.auditIntegrity.lastVerifiedAt === null
                ? 'Never'
                : new Date(
                    snapshot.auditIntegrity.lastVerifiedAt,
                  ).toLocaleString()}
            </dd>
          </dl>
          <Link href={`/workspaces/${workspaceId}/audit`}>
            View audit trail
          </Link>
        </article>
      </section>

      <section
        className="panel operations-timeline"
        aria-labelledby="run-outcome-timeline-heading"
      >
        <h2 id="run-outcome-timeline-heading">Run-outcome timeline</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Bucket start</th>
                <th>Succeeded</th>
                <th>Failed</th>
                <th>Timed out</th>
                <th>Interrupted</th>
                <th>Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.runOutcomeTimeline.map((bucket) => (
                <tr key={bucket.startsAt}>
                  <td>{new Date(bucket.startsAt).toLocaleString()}</td>
                  <td>{bucket.succeeded}</td>
                  <td>{bucket.failed}</td>
                  <td>{bucket.timedOut}</td>
                  <td>{bucket.interrupted}</td>
                  <td>{bucket.cancelled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="metadata">
        Generated {new Date(snapshot.generatedAt).toLocaleString()} using a
        fixed {snapshot.window.selected} window.
      </p>
    </>
  );
}
