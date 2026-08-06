import Link from 'next/link';

interface WorkspaceNavProps {
  workspaceId: string;
  currentPage: 'workflows' | 'runs' | 'schedules' | 'approvals' | 'repairs' | 'audit';
}

export function WorkspaceNav({ workspaceId, currentPage }: WorkspaceNavProps) {
  return (
    <nav aria-label="Workspace navigation" className="workspace-nav">
      <Link
        href={`/workspaces/${workspaceId}/workflows`}
        className={currentPage === 'workflows' ? 'active' : undefined}
      >
        Workflows
      </Link>
      <Link
        href={`/workspaces/${workspaceId}/runs`}
        className={currentPage === 'runs' ? 'active' : undefined}
      >
        Runs
      </Link>
      <Link
        href={`/workspaces/${workspaceId}/schedules`}
        className={currentPage === 'schedules' ? 'active' : undefined}
      >
        Schedules
      </Link>
      <Link
        href={`/workspaces/${workspaceId}/approvals`}
        className={currentPage === 'approvals' ? 'active' : undefined}
      >
        Approvals
      </Link>
      <Link
        href={`/workspaces/${workspaceId}/repairs`}
        className={currentPage === 'repairs' ? 'active' : undefined}
      >
        Repairs
      </Link>
      <Link
        href={`/workspaces/${workspaceId}/audit`}
        className={currentPage === 'audit' ? 'active' : undefined}
      >
        Audit
      </Link>
    </nav>
  );
}
