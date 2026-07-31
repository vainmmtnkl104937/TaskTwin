import type { IncomingHttpHeaders } from 'node:http';

export const AUTHENTICATED_RUN_LEASE = Symbol('authenticated-run-lease');

export interface AuthenticatedRunLease {
  workflowRunId: string;
  leaseTokenHash: string;
}

export interface RunLeaseRequest {
  headers: IncomingHttpHeaders;
  params?: Record<string, unknown>;
  [AUTHENTICATED_RUN_LEASE]?: AuthenticatedRunLease;
}
