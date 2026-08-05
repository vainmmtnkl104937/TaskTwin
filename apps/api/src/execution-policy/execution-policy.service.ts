import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ExecutionPolicyRepository,
  ExecutionPolicyRepositoryError,
} from '@tasktwin/database';

import {
  CreateExecutionPolicyVersionRequestSchema,
  type ActiveExecutionPolicyResponse,
  type CreateExecutionPolicyVersionResponse,
  type ExecutionPolicyVersionListResponse,
} from './execution-policy.contracts.js';
import {
  toActiveExecutionPolicyResponse,
  toCreateExecutionPolicyVersionResponse,
  toExecutionPolicyVersionListResponse,
} from './execution-policy-response.mapper.js';

function rethrow(error: unknown): never {
  if (!(error instanceof ExecutionPolicyRepositoryError)) throw error;
  switch (error.code) {
    case 'POLICY_NOT_FOUND':
      throw new NotFoundException();
    case 'POLICY_FORBIDDEN':
      throw new ForbiddenException();
    case 'POLICY_MISSING':
      throw new InternalServerErrorException({
        code: 'WORKSPACE_EXECUTION_POLICY_MISSING',
        message: 'The Workspace execution policy is unavailable.',
      });
    case 'POLICY_INVALID':
      throw new BadRequestException({
        code: error.code,
        message: 'The execution policy is invalid.',
      });
    case 'POLICY_REVISION_CONFLICT':
      throw new ConflictException({
        code: error.code,
        message: 'The active execution policy revision has changed.',
        ...(error.currentRevision === undefined
          ? {}
          : { currentRevision: error.currentRevision }),
      });
    case 'POLICY_VERSION_CONFLICT':
      throw new ConflictException({
        code: error.code,
        message: 'The policy version request conflicts with existing data.',
      });
    case 'POLICY_SERIALIZATION_FAILURE':
      throw new ServiceUnavailableException({
        code: error.code,
        message: 'The policy update could not be serialized safely.',
      });
  }
}

@Injectable()
export class ExecutionPolicyService {
  constructor(private readonly repository: ExecutionPolicyRepository) {}

  async active(
    userId: string,
    workspaceId: string,
  ): Promise<ActiveExecutionPolicyResponse> {
    try {
      return toActiveExecutionPolicyResponse(
        await this.repository.getActive(userId, workspaceId),
      );
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async versions(
    userId: string,
    workspaceId: string,
  ): Promise<ExecutionPolicyVersionListResponse> {
    try {
      return toExecutionPolicyVersionListResponse(
        await this.repository.listVersions(userId, workspaceId),
      );
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async createVersion(
    userId: string,
    workspaceId: string,
    input: unknown,
  ): Promise<CreateExecutionPolicyVersionResponse> {
    const request = CreateExecutionPolicyVersionRequestSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException({
        code: 'POLICY_INVALID',
        message: 'The execution-policy request is invalid.',
      });
    }
    try {
      const result = await this.repository.createVersion({
        userId,
        workspaceId,
        ...request.data,
        now: new Date(),
      });
      return toCreateExecutionPolicyVersionResponse(
        result.record,
        result.idempotent,
      );
    } catch (error: unknown) {
      rethrow(error);
    }
  }
}
