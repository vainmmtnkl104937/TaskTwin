import Link from 'next/link';
import type { OperationalAlertActionTarget } from '@tasktwin/operational-alerts';

export function notificationHref(target: OperationalAlertActionTarget): string {
  switch (target.kind) {
    case 'approval': return `/workspaces/${target.workspaceId}/approvals/${target.approvalRequestId}`;
    case 'repair': return `/workspaces/${target.workspaceId}/repairs/${target.repairRequestId}`;
    case 'run': return `/workspaces/${target.workspaceId}/runs/${target.workflowRunId}`;
    case 'schedule': return `/workspaces/${target.workspaceId}/schedules/${target.workflowScheduleId}`;
    case 'audit': return `/workspaces/${target.workspaceId}/audit`;
  }
}
export function NotificationLink({ target, label }: { target: OperationalAlertActionTarget; label: string }) {
  return <Link href={notificationHref(target)}>{label}</Link>;
}
