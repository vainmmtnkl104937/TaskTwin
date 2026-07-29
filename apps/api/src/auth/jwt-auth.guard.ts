import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IdentityRepository } from '@tasktwin/database';

import {
  AUTHENTICATED_USER,
  type AuthenticatedRequest,
} from './authenticated-request.js';
import { type JwtAccessPayload, toAuthenticatedUser } from './auth.types.js';

function getBearerToken(authorization: string | undefined): string {
  if (authorization === undefined) {
    throw new UnauthorizedException();
  }

  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (match?.[1] === undefined) {
    throw new UnauthorizedException();
  }

  return match[1];
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly identityRepository: IdentityRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = Array.isArray(request.headers.authorization)
      ? undefined
      : request.headers.authorization;
    const token = getBearerToken(authorization);

    let payload: JwtAccessPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtAccessPayload>(token, {
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException();
    }

    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new UnauthorizedException();
    }

    const user = await this.identityRepository.findSafeUserById(payload.sub);
    if (user === null || !user.isActive) {
      throw new UnauthorizedException();
    }

    request[AUTHENTICATED_USER] = toAuthenticatedUser(user);
    return true;
  }
}
