import type { WorkflowLifecycleStatus } from '@tasktwin/workflow-schema';

const STATUS_LABELS: Record<WorkflowLifecycleStatus, string> = {
  draft: 'Draft',
  testing: 'Testing',
  published: 'Published',
  archived: 'Archived',
};

export function LifecycleStatusBadge({
  status,
}: {
  status: WorkflowLifecycleStatus;
}) {
  return (
    <span className={`status-badge status-${status}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
