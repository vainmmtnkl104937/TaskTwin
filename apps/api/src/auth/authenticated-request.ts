import type { IncomingHttpHeaders } from 'node:http';

import type { AuthenticatedUser } from './auth.types.js';

export const AUTHENTICATED_USER = Symbol('authenticated-user');

export interface AuthenticatedRequest {
  headers: IncomingHttpHeaders;
  [AUTHENTICATED_USER]?: AuthenticatedUser;
}
