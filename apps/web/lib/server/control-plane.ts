import 'server-only';

import type { z } from 'zod';

import {
  LoginResponseSchema,
  WorkflowVersionDetailResponseSchema,
  WorkspaceListResponseSchema,
  WorkspaceWorkflowListResponseSchema,
} from '../control-plane-contracts';
import { getControlPlaneOrigin } from './environment';

export class ControlPlaneError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Control Plane request failed with status ${status}.`);
    this.name = 'ControlPlaneError';
  }
}

async function request<Response>(
  path: string,
  schema: z.ZodType<Response>,
  init: RequestInit,
): Promise<Response> {
  const response = await fetch(`${getControlPlaneOrigin()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ControlPlaneError(response.status, body);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new Error('The Control Plane returned an invalid response.');
  }
  return parsed.data;
}

export function login(email: string, password: string) {
  return request('/auth/login', LoginResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function listWorkspaces(accessToken: string) {
  return request('/workspaces', WorkspaceListResponseSchema, {
    method: 'GET',
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

export function listWorkflows(accessToken: string, workspaceId: string) {
  return request(
    `/workspaces/${encodeURIComponent(workspaceId)}/workflows`,
    WorkspaceWorkflowListResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function getWorkflowVersion(
  accessToken: string,
  workflowVersionId: string,
) {
  return request(
    `/workflow-versions/${encodeURIComponent(workflowVersionId)}`,
    WorkflowVersionDetailResponseSchema,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
}

export function patchWorkflowDraft(
  accessToken: string,
  workflowVersionId: string,
  expectedRevision: number,
  definition: unknown,
) {
  return request(
    `/workflow-versions/${encodeURIComponent(workflowVersionId)}/draft`,
    WorkflowVersionDetailResponseSchema,
    {
      method: 'PATCH',
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ expectedRevision, definition }),
    },
  );
}
