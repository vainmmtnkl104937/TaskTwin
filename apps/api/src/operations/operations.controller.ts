import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrganizationRole } from '@tasktwin/database';
import {
  OperationalTelemetryError,
  parseMetricWindow,
  type WorkspaceOperationsSnapshot,
} from '@tasktwin/operational-telemetry';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { OrganizationResourceContextGuard } from '../authorization/organization-resource-context.guard.js';
import { ResolveOrganizationResource } from '../authorization/organization-resource.decorator.js';
import { OrganizationRoleGuard } from '../authorization/organization-role.guard.js';
import { RequireOrganizationRoles } from '../authorization/organization-roles.decorator.js';
import { OperationsQueryService } from './operations-query.service.js';

const READERS = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
  OrganizationRole.VIEWER,
] as const;

@Controller()
@UseGuards(
  JwtAuthGuard,
  OrganizationResourceContextGuard,
  OrganizationRoleGuard,
)
export class OperationsController {
  constructor(private readonly service: OperationsQueryService) {}

  @Get('workspaces/:workspaceId/operations/overview')
  @ResolveOrganizationResource('workspace', 'workspaceId')
  @RequireOrganizationRoles(...READERS)
  async overview(
    @Param('workspaceId') workspaceId: string,
    @Query('window') rawWindow?: string,
  ): Promise<WorkspaceOperationsSnapshot> {
    try {
      return await this.service.getSnapshot({
        workspaceId,
        window: parseMetricWindow(rawWindow ?? '24h'),
      });
    } catch (error) {
      if (
        error instanceof OperationalTelemetryError &&
        error.code === 'TELEMETRY_WINDOW_UNSUPPORTED'
      ) {
        throw new BadRequestException({
          code: error.code,
          message: 'Unsupported metric window.',
        });
      }
      throw error;
    }
  }
}
