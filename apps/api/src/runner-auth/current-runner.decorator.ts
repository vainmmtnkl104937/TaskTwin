import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

import {
  AUTHENTICATED_RUNNER,
  type AuthenticatedRunner,
  type RunnerAuthenticatedRequest,
} from './runner-authenticated-request.js';

export const CurrentRunner = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedRunner => {
    const request = context
      .switchToHttp()
      .getRequest<RunnerAuthenticatedRequest>();
    const runner = request[AUTHENTICATED_RUNNER];
    if (runner === undefined) {
      throw new UnauthorizedException();
    }
    return runner;
  },
);
