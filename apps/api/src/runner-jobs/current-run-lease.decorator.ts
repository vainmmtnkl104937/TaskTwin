import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

import {
  AUTHENTICATED_RUN_LEASE,
  type AuthenticatedRunLease,
  type RunLeaseRequest,
} from './runner-job-lease-context.js';

export const CurrentRunLease = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedRunLease => {
    const request = context.switchToHttp().getRequest<RunLeaseRequest>();
    const lease = request[AUTHENTICATED_RUN_LEASE];
    if (lease === undefined) {
      throw new UnauthorizedException();
    }
    return lease;
  },
);
