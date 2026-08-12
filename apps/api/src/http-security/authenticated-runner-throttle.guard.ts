import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorage } from '@nestjs/throttler';

import {
  AUTHENTICATED_RUNNER,
  type RunnerAuthenticatedRequest,
} from '../runner-auth/runner-authenticated-request.js';
import {
  digestThrottleIdentity,
  THROTTLE_RULES,
} from './scoped-throttle.guard.js';
import {
  THROTTLE_SCOPE_METADATA,
  type ThrottleScope,
} from './scoped-throttle.decorator.js';

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class AuthenticatedRunnerThrottleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectThrottlerStorage()
    private readonly storage: ThrottlerStorage,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.getAllAndOverride<ThrottleScope | undefined>(
      THROTTLE_SCOPE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (scope === undefined || !scope.startsWith('runner_')) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<RunnerAuthenticatedRequest>();
    const response = http.getResponse<HeaderResponse>();
    const runner = request[AUTHENTICATED_RUNNER];
    if (runner === undefined) return true;
    const rule = THROTTLE_RULES[scope];
    const record = await this.storage.increment(
      digestThrottleIdentity(`${scope}:runner:${runner.runnerDeviceId}`),
      rule.ttlMs,
      rule.limit,
      rule.blockMs,
      `${scope}_runner`,
    );
    if (record.isBlocked) {
      response.setHeader(
        'Retry-After',
        String(Math.max(1, record.timeToBlockExpire)),
      );
      throw new HttpException(
        { code: 'RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
