import { createHmac } from 'node:crypto';

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
import { normalizeEmail } from '@tasktwin/database';

import { getRunnerSecurityConfiguration } from '../config/environment.js';
import type { SecurityHttpRequest } from './http-request.js';
import {
  THROTTLE_SCOPE_METADATA,
  type ThrottleScope,
} from './scoped-throttle.decorator.js';

export interface LimitRule {
  limit: number;
  ttlMs: number;
  blockMs: number;
}

export const THROTTLE_RULES: Record<ThrottleScope, LimitRule> = {
  login: { limit: 120, ttlMs: 60_000, blockMs: 60_000 },
  registration: { limit: 20, ttlMs: 60_000, blockMs: 300_000 },
  pairing_create: { limit: 20, ttlMs: 60_000, blockMs: 60_000 },
  pairing_poll: { limit: 60, ttlMs: 60_000, blockMs: 60_000 },
  runner_standard: { limit: 180, ttlMs: 60_000, blockMs: 30_000 },
  runner_claim: { limit: 90, ttlMs: 60_000, blockMs: 30_000 },
  runner_progress: { limit: 600, ttlMs: 60_000, blockMs: 15_000 },
};

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

function clientAddress(request: SecurityHttpRequest): string {
  return request.ip ?? request.socket.remoteAddress ?? 'unknown-client';
}

export function digestThrottleIdentity(value: string): string {
  return createHmac('sha256', getRunnerSecurityConfiguration().credentialPepper)
    .update('http-throttle:v1')
    .update('\0')
    .update(value)
    .digest('hex');
}

@Injectable()
export class ScopedThrottleGuard implements CanActivate {
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
    if (scope === undefined) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<SecurityHttpRequest>();
    const response = http.getResponse<HeaderResponse>();
    const rule = THROTTLE_RULES[scope];
    const identities = this.identities(scope, request);
    let retryAfter = 0;
    for (const identity of identities) {
      const identityRule = identity.startsWith('account:')
        ? { limit: 10, ttlMs: 60_000, blockMs: 60_000 }
        : rule;
      const record = await this.storage.increment(
        digestThrottleIdentity(`${scope}:${identity}`),
        identityRule.ttlMs,
        identityRule.limit,
        identityRule.blockMs,
        scope,
      );
      if (record.isBlocked) {
        retryAfter = Math.max(retryAfter, record.timeToBlockExpire);
      }
    }
    if (retryAfter > 0) {
      response.setHeader('Retry-After', String(Math.max(1, retryAfter)));
      throw new HttpException(
        { code: 'RATE_LIMITED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private identities(
    scope: ThrottleScope,
    request: SecurityHttpRequest,
  ): string[] {
    const identities = [`ip:${clientAddress(request)}`];
    if (scope === 'login') {
      const email =
        typeof request.body === 'object' &&
        request.body !== null &&
        'email' in request.body &&
        typeof request.body.email === 'string'
          ? normalizeEmail(request.body.email).slice(0, 254)
          : 'invalid-account';
      identities.push(`account:${digestThrottleIdentity(email)}`);
    }
    return identities;
  }
}
