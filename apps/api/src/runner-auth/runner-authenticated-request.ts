import type { IncomingHttpHeaders } from 'node:http';

export const AUTHENTICATED_RUNNER = Symbol('authenticated-runner');

export interface AuthenticatedRunner {
  runnerDeviceId: string;
  workspaceId: string;
  credentialId: string;
}

export interface RunnerAuthenticatedRequest {
  headers: IncomingHttpHeaders;
  [AUTHENTICATED_RUNNER]?: AuthenticatedRunner;
}
