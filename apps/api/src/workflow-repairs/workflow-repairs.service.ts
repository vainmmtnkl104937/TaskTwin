import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  WorkflowRepairRepository,
  WorkflowRepairRepositoryError,
} from '@tasktwin/database';
import {
  RepairDecisionRequestSchema,
  RepairDecisionResponseSchema,
  RepairRequestDetailResponseSchema,
  RepairRequestListResponseSchema,
} from '@tasktwin/workflow-recovery';

import { safeRepair } from './workflow-repair-response.mapper.js';

function access(role: string) {
  return {
    role,
    canRetry: role === 'OWNER' || role === 'ADMIN',
    canAbort: role === 'OWNER' || role === 'ADMIN' || role === 'MEMBER',
  };
}

function rethrow(error: unknown): never {
  if (!(error instanceof WorkflowRepairRepositoryError)) throw error;
  switch (error.code) {
    case 'REPAIR_NOT_FOUND':
      throw new NotFoundException();
    case 'REPAIR_FORBIDDEN':
      throw new ForbiddenException();
    case 'REPAIR_CONFLICT':
    case 'REPAIR_EXPIRED':
      throw new ConflictException({
        code: error.code,
        message: 'The repair request can no longer be decided.',
      });
    default:
      throw new BadRequestException('Invalid repair request.');
  }
}

@Injectable()
export class WorkflowRepairsService {
  constructor(private readonly repository: WorkflowRepairRepository) {}

  async list(userId: string, workspaceId: string) {
    try {
      const result = await this.repository.listForWorkspace(
        userId,
        workspaceId,
      );
      return RepairRequestListResponseSchema.parse({
        schemaVersion: 1,
        workspaceId,
        access: access(result.access.role),
        requests: result.records.map(safeRepair),
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async detail(userId: string, repairRequestId: string) {
    try {
      const result = await this.repository.getForUser(userId, repairRequestId);
      return RepairRequestDetailResponseSchema.parse({
        schemaVersion: 1,
        access: access(result.access.role),
        request: safeRepair(result.record),
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async decide(
    userId: string,
    repairRequestId: string,
    decision: 'RETRY_APPROVED' | 'ABORTED',
    input: unknown,
  ) {
    const parsed = RepairDecisionRequestSchema.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException('Invalid repair decision.');
    try {
      const result = await this.repository.decide({
        userId,
        repairRequestId,
        decision,
        clientDecisionId: parsed.data.clientDecisionId,
        now: new Date(),
      });
      return RepairDecisionResponseSchema.parse({
        schemaVersion: 1,
        idempotent: result.idempotent,
        request: safeRepair(result.record),
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }
}
