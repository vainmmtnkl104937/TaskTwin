import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  WorkflowLocatorRepairRepository,
  WorkflowLocatorRepairRepositoryError,
} from '@tasktwin/database';
import {
  ApplyLocatorRepairToDraftRequestSchema,
  ApplyLocatorRepairToDraftResponseSchema,
  LocatorRepairCandidateTestRequestSchema,
  LocatorRepairCandidateTestRequestResponseSchema,
  LocatorRepairProposalDetailResponseSchema,
  LocatorRepairProposalListResponseSchema,
} from '@tasktwin/workflow-locator-repair';

import {
  safeLocatorRepairAccess,
  safeLocatorRepairProposal,
} from './workflow-locator-repair-response.mapper.js';

function rethrow(error: unknown): never {
  if (!(error instanceof WorkflowLocatorRepairRepositoryError)) throw error;
  if (error.code === 'LOCATOR_REPAIR_NOT_FOUND') throw new NotFoundException();
  if (error.code === 'LOCATOR_REPAIR_FORBIDDEN') throw new ForbiddenException();
  if (error.code === 'SERIALIZATION_FAILURE') {
    throw new ServiceUnavailableException();
  }
  throw new ConflictException({
    code: error.code,
    message: 'The locator repair operation conflicts with current state.',
  });
}

@Injectable()
export class WorkflowLocatorRepairsService {
  constructor(private readonly repository: WorkflowLocatorRepairRepository) {}

  async list(userId: string, workspaceId: string) {
    try {
      const result = await this.repository.listForWorkspace(
        userId,
        workspaceId,
      );
      return LocatorRepairProposalListResponseSchema.parse({
        schemaVersion: 1,
        workspaceId,
        access: safeLocatorRepairAccess(result.access),
        proposals: result.records.map(safeLocatorRepairProposal),
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async detail(userId: string, proposalId: string) {
    try {
      const result = await this.repository.getForUser(userId, proposalId);
      return LocatorRepairProposalDetailResponseSchema.parse({
        schemaVersion: 1,
        access: safeLocatorRepairAccess(result.access),
        proposal: safeLocatorRepairProposal(result.record),
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async requestTest(userId: string, candidateId: string, body: unknown) {
    const request = LocatorRepairCandidateTestRequestSchema.safeParse(body);
    if (!request.success)
      throw new BadRequestException('Invalid candidate test request.');
    try {
      const result = await this.repository.requestCandidateTest({
        userId,
        candidateId,
        request: request.data,
        now: new Date(),
      });
      const candidate = result.record.candidates.find(
        (item) => item.id === candidateId,
      );
      if (candidate === undefined) throw new NotFoundException();
      return LocatorRepairCandidateTestRequestResponseSchema.parse({
        schemaVersion: 1,
        candidateId,
        status: candidate.testStatus,
        idempotent: result.idempotent,
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async apply(userId: string, proposalId: string, body: unknown) {
    const request = ApplyLocatorRepairToDraftRequestSchema.safeParse(body);
    if (!request.success)
      throw new BadRequestException('Invalid locator repair apply request.');
    try {
      const result = await this.repository.applyToDraft({
        userId,
        proposalId,
        request: request.data,
        now: new Date(),
      });
      return ApplyLocatorRepairToDraftResponseSchema.parse({
        schemaVersion: 1,
        ...result,
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }
}
