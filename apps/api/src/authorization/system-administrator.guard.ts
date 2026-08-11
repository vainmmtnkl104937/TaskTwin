import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import {
  AUTHENTICATED_USER,
  type AuthenticatedRequest,
} from '../auth/authenticated-request.js';

@Injectable()
export class SystemAdministratorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request[AUTHENTICATED_USER];
    if (user === undefined) throw new UnauthorizedException();
    if (!user.isSystemAdministrator) throw new ForbiddenException();
    return true;
  }
}
