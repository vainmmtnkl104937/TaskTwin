import { timingSafeEqual } from 'node:crypto';

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { RunnerRepository } from '@tasktwin/database';
import { parseRunnerAuthorizationHeader } from '@tasktwin/runner-protocol';

import { PairingCryptoService } from '../runner-pairing/pairing-crypto.service.js';
import {
  AUTHENTICATED_RUNNER,
  type RunnerAuthenticatedRequest,
} from './runner-authenticated-request.js';

@Injectable()
export class RunnerCredentialGuard implements CanActivate {
  constructor(
    private readonly repository: RunnerRepository,
    private readonly crypto: PairingCryptoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<RunnerAuthenticatedRequest>();
    const authorization = Array.isArray(request.headers.authorization)
      ? undefined
      : request.headers.authorization;
    const presented = parseRunnerAuthorizationHeader(authorization);
    if (presented === null) {
      throw new UnauthorizedException();
    }
    const stored = await this.repository.findRunnerAuthentication(
      presented.runnerDeviceId,
    );
    if (
      stored === null ||
      stored.deviceRevokedAt !== null ||
      stored.credentialRevokedAt !== null
    ) {
      throw new UnauthorizedException();
    }
    const presentedHash = Buffer.from(
      this.crypto.hashCredential(presented.credential),
      'hex',
    );
    const storedHash = Buffer.from(stored.credentialHash, 'hex');
    if (
      presentedHash.length !== storedHash.length ||
      !timingSafeEqual(presentedHash, storedHash)
    ) {
      throw new UnauthorizedException();
    }
    request[AUTHENTICATED_RUNNER] = {
      runnerDeviceId: stored.runnerDeviceId,
      workspaceId: stored.workspaceId,
      credentialId: stored.credentialId,
    };
    return true;
  }
}
