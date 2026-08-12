import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  WorkflowApprovalRepository,
  WorkflowApprovalRepositoryError,
} from '@tasktwin/database';
import {
  ApprovalDecisionRequestSchema,
  ApprovalDecisionResponseSchema,
  ApprovalRequestDetailResponseSchema,
  ApprovalRequestListResponseSchema,
} from '@tasktwin/workflow-approval';
import { z } from 'zod';

import {
  decodeTimeIdCursor,
  encodeTimeIdCursor,
} from '../common/time-id-cursor.js';

import { safeApproval } from './workflow-approval-response.mapper.js';

const ApprovalListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
});

function canDecide(role: string): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

function rethrow(error: unknown): never {
  if (!(error instanceof WorkflowApprovalRepositoryError)) throw error;
  switch (error.code) {
    case 'APPROVAL_NOT_FOUND':
      throw new NotFoundException();
    case 'APPROVAL_FORBIDDEN':
      throw new ForbiddenException();
    case 'APPROVAL_EXPIRED':
    case 'APPROVAL_CONFLICT':
      throw new ConflictException({
        code: error.code,
        message: 'The approval request can no longer be decided.',
      });
    default:
      throw new BadRequestException('Invalid approval request.');
  }
}

@Injectable()
export class WorkflowApprovalsService {
  constructor(private readonly repository: WorkflowApprovalRepository) {}

  async list(
    userId: string,
    workspaceId: string,
    rawQuery: { limit?: string; cursor?: string } = {},
  ) {
    const query = ApprovalListQuerySchema.safeParse(rawQuery);
    if (!query.success)
      throw new BadRequestException('Invalid approval list query.');
    let cursor: ReturnType<typeof decodeTimeIdCursor> | undefined;
    try {
      cursor =
        query.data.cursor === undefined
          ? undefined
          : decodeTimeIdCursor(query.data.cursor);
    } catch {
      throw new BadRequestException('Invalid approval list cursor.');
    }
    try {
      const result = await this.repository.listForWorkspace(
        userId,
        workspaceId,
        {
          limit: query.data.limit,
          ...(cursor === undefined
            ? {}
            : { cursor: { requestedAt: cursor.time, id: cursor.id } }),
        },
      );
      return ApprovalRequestListResponseSchema.parse({
        schemaVersion: 1,
        workspaceId,
        access: {
          role: result.access.role,
          canDecide: canDecide(result.access.role),
        },
        requests: result.records.map(safeApproval),
        nextCursor:
          result.nextCursor === null
            ? null
            : encodeTimeIdCursor({
                time: result.nextCursor.requestedAt,
                id: result.nextCursor.id,
              }),
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async detail(userId: string, approvalRequestId: string) {
    try {
      const result = await this.repository.getForUser(
        userId,
        approvalRequestId,
      );
      return ApprovalRequestDetailResponseSchema.parse({
        schemaVersion: 1,
        access: {
          role: result.access.role,
          canDecide: canDecide(result.access.role),
        },
        request: safeApproval(result.record),
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async decide(
    userId: string,
    approvalRequestId: string,
    decision: 'APPROVED' | 'REJECTED',
    input: unknown,
  ) {
    const parsed = ApprovalDecisionRequestSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Invalid approval decision.');
    try {
      const result = await this.repository.decide({
        userId,
        approvalRequestId,
        decision,
        clientDecisionId: parsed.data.clientDecisionId,
        now: new Date(),
      });
      return ApprovalDecisionResponseSchema.parse({
        schemaVersion: 1,
        idempotent: result.idempotent,
        request: safeApproval(result.record),
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }
}
