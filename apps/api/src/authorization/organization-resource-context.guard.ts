import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RecordingRepository } from '@tasktwin/database';

import {
  AUTHENTICATED_USER,
  type AuthenticatedRequest,
} from '../auth/authenticated-request.js';
import {
  attachVerifiedOrganizationContext,
  type OrganizationContextRequest,
} from './organization-context.js';
import {
  ORGANIZATION_RESOURCE_METADATA,
  type OrganizationResourceMetadata,
} from './organization-resource.decorator.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface OrganizationResourceRequest
  extends AuthenticatedRequest, OrganizationContextRequest {
  params?: Record<string, unknown>;
}

@Injectable()
export class OrganizationResourceContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly recordingRepository: RecordingRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata =
      this.reflector.getAllAndOverride<OrganizationResourceMetadata>(
        ORGANIZATION_RESOURCE_METADATA,
        [context.getHandler(), context.getClass()],
      );

    if (metadata === undefined) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<OrganizationResourceRequest>();
    const user = request[AUTHENTICATED_USER];
    if (user === undefined) {
      throw new UnauthorizedException();
    }

    const resourceId = request.params?.[metadata.parameterName];
    if (typeof resourceId !== 'string' || !UUID_PATTERN.test(resourceId)) {
      throw new BadRequestException('Invalid resource identifier');
    }

    const access =
      metadata.kind === 'workspace'
        ? await this.recordingRepository.resolveWorkspaceAccess(
            user.id,
            resourceId,
          )
        : await this.recordingRepository.resolveRecordingSessionAccess(
            user.id,
            resourceId,
          );

    if (access === null || access.userId !== user.id) {
      throw new NotFoundException();
    }

    attachVerifiedOrganizationContext(request, access);
    return true;
  }
}
