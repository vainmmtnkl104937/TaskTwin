import type { WorkflowRunStatus } from '@tasktwin/run-protocol';

export function WorkflowRunStatusBadge({
  status,
}: {
  status: WorkflowRunStatus;
}) {
  return (
    <span className={`status-badge run-status-${status.toLowerCase()}`}>
      {status}
    </span>
  );
}
