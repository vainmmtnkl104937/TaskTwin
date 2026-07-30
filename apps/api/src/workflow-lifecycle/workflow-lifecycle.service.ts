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
  WorkflowLifecycleRepository,
  WorkflowLifecycleRepositoryError,
} from '@tasktwin/database';

import {
  CreateWorkflowVersionRequestSchema,
  EmptyLifecycleRequestSchema,
  ExpectedRevisionRequestSchema,
  type WorkflowLifecycleActionResponse,
  type WorkflowVersionHistoryResponse,
} from './workflow-lifecycle.contracts.js';
import {
  toWorkflowLifecycleActionResponse,
  toWorkflowVersionHistoryResponse,
} from './workflow-lifecycle-response.mapper.js';

function rethrowRepositoryError(error: unknown): never {
  if (!(error instanceof WorkflowLifecycleRepositoryError)) {
    throw error;
  }

  switch (error.code) {
    case 'INVALID_LIFECYCLE_INPUT':
      throw new BadRequestException({
        code: error.code,
        message: 'The workflow lifecycle request is invalid.',
      });
    case 'WORKFLOW_NOT_FOUND':
    case 'WORKFLOW_VERSION_NOT_FOUND':
      throw new NotFoundException();
    case 'WORKFLOW_LIFECYCLE_FORBIDDEN':
      throw new ForbiddenException();
    case 'INVALID_LIFECYCLE_TRANSITION':
      throw new ConflictException({
        code: error.code,
        message: 'The workflow lifecycle transition is not allowed.',
      });
    case 'WORKFLOW_PUBLISH_READINESS_BLOCKED':
      throw new ConflictException({
        code: error.code,
        message: 'The workflow has blocking publish-readiness issues.',
        ...(error.context.readiness === undefined
          ? {}
          : { readiness: error.context.readiness }),
      });
    case 'WORKFLOW_VERSION_REVISION_CONFLICT':
      throw new ConflictException({
        code: error.code,
        message: 'The workflow version revision is stale.',
        ...(error.context.currentRevision === undefined
          ? {}
          : { currentRevision: error.context.currentRevision }),
      });
    case 'WORKFLOW_VERSION_CREATION_CONFLICT':
      throw new ConflictException({
        code: error.code,
        message: 'The workflow version creation request conflicts with data.',
      });
    case 'SOURCE_VERSION_NOT_CLONEABLE':
      throw new ConflictException({
        code: error.code,
        message: 'A new draft requires a published or archived source version.',
      });
    case 'SERIALIZATION_FAILURE':
      throw new ServiceUnavailableException({
        code: error.code,
        message: 'The workflow lifecycle operation could not be serialized.',
      });
    case 'PERSISTED_WORKFLOW_INVALID':
      throw new InternalServerErrorException(
        'Stored workflow data is unavailable.',
      );
  }
}

@Injectable()
export class WorkflowLifecycleService {
  constructor(
    private readonly workflowLifecycleRepository: WorkflowLifecycleRepository,
  ) {}

  async listVersions(
    actorUserId: string,
    workflowId: string,
  ): Promise<WorkflowVersionHistoryResponse> {
    const record = await this.workflowLifecycleRepository.listVersions(
      actorUserId,
      workflowId,
    );
    if (record === null) {
      throw new NotFoundException();
    }
    return toWorkflowVersionHistoryResponse(record);
  }

  async submitForTesting(
    actorUserId: string,
    versionId: string,
    input: unknown,
  ): Promise<WorkflowLifecycleActionResponse> {
    const request = ExpectedRevisionRequestSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException('Invalid lifecycle request.');
    }
    try {
      return toWorkflowLifecycleActionResponse(
        await this.workflowLifecycleRepository.submitForTesting(
          actorUserId,
          versionId,
          request.data.expectedRevision,
        ),
      );
    } catch (error: unknown) {
      rethrowRepositoryError(error);
    }
  }

  async returnToDraft(
    actorUserId: string,
    versionId: string,
    input: unknown,
  ): Promise<WorkflowLifecycleActionResponse> {
    const request = ExpectedRevisionRequestSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException('Invalid lifecycle request.');
    }
    try {
      return toWorkflowLifecycleActionResponse(
        await this.workflowLifecycleRepository.returnToDraft(
          actorUserId,
          versionId,
          request.data.expectedRevision,
        ),
      );
    } catch (error: unknown) {
      rethrowRepositoryError(error);
    }
  }

  async publish(
    actorUserId: string,
    versionId: string,
    input: unknown,
  ): Promise<WorkflowLifecycleActionResponse> {
    const request = ExpectedRevisionRequestSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException('Invalid lifecycle request.');
    }
    try {
      return toWorkflowLifecycleActionResponse(
        await this.workflowLifecycleRepository.publish(
          actorUserId,
          versionId,
          request.data.expectedRevision,
          new Date(),
        ),
      );
    } catch (error: unknown) {
      rethrowRepositoryError(error);
    }
  }

  async archive(
    actorUserId: string,
    versionId: string,
    input: unknown,
  ): Promise<WorkflowLifecycleActionResponse> {
    if (!EmptyLifecycleRequestSchema.safeParse(input).success) {
      throw new BadRequestException('Invalid lifecycle request.');
    }
    try {
      return toWorkflowLifecycleActionResponse(
        await this.workflowLifecycleRepository.archive(
          actorUserId,
          versionId,
          new Date(),
        ),
      );
    } catch (error: unknown) {
      rethrowRepositoryError(error);
    }
  }

  async createVersion(
    actorUserId: string,
    workflowId: string,
    input: unknown,
  ): Promise<WorkflowLifecycleActionResponse> {
    const request = CreateWorkflowVersionRequestSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException('Invalid workflow version request.');
    }
    try {
      const result = await this.workflowLifecycleRepository.createDraftVersion(
        actorUserId,
        workflowId,
        request.data.sourceVersionId,
        request.data.clientCreationId,
        new Date(),
      );
      return toWorkflowLifecycleActionResponse({
        ...result,
        readiness: null,
      });
    } catch (error: unknown) {
      rethrowRepositoryError(error);
    }
  }
}
