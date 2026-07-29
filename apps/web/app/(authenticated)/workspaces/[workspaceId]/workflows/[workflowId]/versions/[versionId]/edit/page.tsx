import { notFound, redirect } from 'next/navigation';

import { WorkflowEditor } from '@/components/workflow-editor/workflow-editor';
import { getAccessToken } from '@/lib/server/auth-session';
import {
  ControlPlaneError,
  getWorkflowVersion,
} from '@/lib/server/control-plane';

export default async function WorkflowEditorPage({
  params,
}: {
  params: Promise<{
    workspaceId: string;
    workflowId: string;
    versionId: string;
  }>;
}) {
  const { workspaceId, workflowId, versionId } = await params;
  const accessToken = await getAccessToken();
  if (accessToken === null) {
    redirect('/login');
  }

  let detail;
  try {
    detail = await getWorkflowVersion(accessToken, versionId);
  } catch (error: unknown) {
    if (error instanceof ControlPlaneError && error.status === 401) {
      redirect('/auth/expired');
    }
    if (error instanceof ControlPlaneError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  if (
    detail.workspaceId !== workspaceId ||
    detail.workflowVersion.workflowId !== workflowId
  ) {
    notFound();
  }

  return <WorkflowEditor detail={detail} workspaceId={workspaceId} />;
}
