import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

import {
  AUTHENTICATED_USER,
  type AuthenticatedRequest,
} from './authenticated-request.js';
import type { AuthenticatedUser } from './auth.types.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request[AUTHENTICATED_USER];

    if (user === undefined) {
      throw new UnauthorizedException();
    }

    return user;
  },
);
