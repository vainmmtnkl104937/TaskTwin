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

import { safeApproval } from './workflow-approval-response.mapper.js';

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

  async list(userId: string, workspaceId: string) {
    try {
      const result = await this.repository.listForWorkspace(
        userId,
        workspaceId,
      );
      return ApprovalRequestListResponseSchema.parse({
        schemaVersion: 1,
        workspaceId,
        access: {
          role: result.access.role,
          canDecide: canDecide(result.access.role),
        },
        requests: result.records.map(safeApproval),
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
