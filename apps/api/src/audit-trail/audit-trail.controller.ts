import {
  BadRequestException,
  Body,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
  createParamDecorator,
} from '@nestjs/common';
import { OrganizationRole } from '@tasktwin/database';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { OrganizationResourceContextGuard } from '../authorization/organization-resource-context.guard.js';
import {
  VERIFIED_ORGANIZATION_CONTEXT,
  type VerifiedOrganizationContext,
} from '../authorization/organization-context.js';
import { ResolveOrganizationResource } from '../authorization/organization-resource.decorator.js';
import { OrganizationRoleGuard } from '../authorization/organization-role.guard.js';
import { RequireOrganizationRoles } from '../authorization/organization-roles.decorator.js';

import { AuditTrailService } from './audit-trail.service.js';
import {
  AuditEventListQuerySchema,
  AuditVerifyRequestSchema,
  type AuditEventDetailResponse,
  type AuditEventListQuery,
  type AuditEventListResponse,
  type AuditVerifyRequest,
  type AuditVerifyResponse,
  type RunEvidenceResponse,
} from './audit-trail.contracts.js';

const READER_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
  OrganizationRole.VIEWER,
] as const;

const VERIFIER_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
] as const;

const QUERY_KEYS = [
  'eventTypes',
  'actorKinds',
  'primaryEntityKind',
  'primaryEntityId',
  'correlationId',
  'fromOccurredAt',
  'toOccurredAt',
  'fromSequence',
  'toSequence',
  'limit',
  'cursor',
] as const;

function coerceStringArray(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    return value.split(',');
  }
  return value;
}

function coerceInt(value: unknown): unknown {
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

function coerceString(value: unknown): unknown {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return value;
}

function parseListQuery(raw: unknown): AuditEventListQuery {
  const source =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const normalized: Record<string, unknown> = {};
  for (const key of QUERY_KEYS) {
    if (!(key in source)) {
      continue;
    }
    const value = source[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (key === 'eventTypes' || key === 'actorKinds') {
      normalized[key] = coerceStringArray(value);
      continue;
    }
    if (key === 'fromSequence' || key === 'toSequence' || key === 'limit') {
      normalized[key] = coerceInt(value);
      continue;
    }
    normalized[key] = coerceString(value);
  }
  const parsed = AuditEventListQuerySchema.safeParse(normalized);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'AUDIT_EVENT_INVALID',
      message: 'Invalid audit query.',
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export const AuditQuery = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): unknown => {
    const request = ctx.switchToHttp().getRequest<{ query?: unknown }>();
    return parseListQuery(request.query ?? {});
  },
);

function readRole(
  request: { [VERIFIED_ORGANIZATION_CONTEXT]?: VerifiedOrganizationContext },
): OrganizationRole {
  return request[VERIFIED_ORGANIZATION_CONTEXT]?.role ?? OrganizationRole.VIEWER;
}

@Controller()
@UseGuards(
  JwtAuthGuard,
  OrganizationResourceContextGuard,
  OrganizationRoleGuard,
)
export class AuditTrailController {
  constructor(private readonly service: AuditTrailService) {}

  @Get('workspaces/:workspaceId/audit-events')
  @ResolveOrganizationResource('workspace', 'workspaceId')
  @RequireOrganizationRoles(...READER_ROLES)
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId') workspaceId: string,
    @AuditQuery() query: AuditEventListQuery,
  ): Promise<AuditEventListResponse> {
    return this.service.listEvents({
      workspaceId,
      actorUserId: user.id,
      query,
    });
  }

  @Get('audit-events/:auditEventId')
  @RequireOrganizationRoles(...READER_ROLES)
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('auditEventId') auditEventId: string,
  ): Promise<AuditEventDetailResponse> {
    return this.service.getEvent({
      actorUserId: user.id,
      auditEventId,
    });
  }

  @Post('workspaces/:workspaceId/audit-trail/verify')
  @HttpCode(HttpStatus.OK)
  @ResolveOrganizationResource('workspace', 'workspaceId')
  @RequireOrganizationRoles(...VERIFIER_ROLES)
  async verify(
    @Param('workspaceId') workspaceId: string,
    @Req() request: { [VERIFIED_ORGANIZATION_CONTEXT]?: VerifiedOrganizationContext },
    @Body() body: unknown,
  ): Promise<AuditVerifyResponse> {
    const parsed = AuditVerifyRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'AUDIT_EVENT_INVALID',
        message: 'Invalid audit verification request.',
        issues: parsed.error.issues,
      });
    }
    const requestBody: AuditVerifyRequest = parsed.data;
    return this.service.verifyChain({
      workspaceId,
      role: readRole(request),
      request: requestBody,
    });
  }

  @Get('workflow-runs/:workflowRunId/evidence')
  @ResolveOrganizationResource('workflowRun', 'workflowRunId')
  @RequireOrganizationRoles(...READER_ROLES)
  async runEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workflowRunId') workflowRunId: string,
  ): Promise<RunEvidenceResponse> {
    return this.service.getRunEvidenceForRun({
      actorUserId: user.id,
      workflowRunId,
    });
  }
}