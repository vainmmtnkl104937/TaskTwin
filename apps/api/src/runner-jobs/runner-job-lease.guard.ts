import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { LeaseTokenSchema } from '@tasktwin/run-protocol';

import {
  AUTHENTICATED_RUN_LEASE,
  type RunLeaseRequest,
} from './runner-job-lease-context.js';
import { RunnerJobLeaseCryptoService } from './runner-job-lease-crypto.service.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class RunnerJobLeaseGuard implements CanActivate {
  constructor(private readonly crypto: RunnerJobLeaseCryptoService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RunLeaseRequest>();
    const workflowRunId = request.params?.workflowRunId;
    const raw = request.headers['x-tasktwin-run-lease'];
    const token = Array.isArray(raw) ? undefined : raw;
    const parsed = LeaseTokenSchema.safeParse(token);
    if (
      typeof workflowRunId !== 'string' ||
      !UUID_PATTERN.test(workflowRunId) ||
      !parsed.success
    ) {
      throw new UnauthorizedException();
    }
    request[AUTHENTICATED_RUN_LEASE] = {
      workflowRunId,
      leaseTokenHash: this.crypto.hashToken(parsed.data),
    };
    return true;
  }
}
