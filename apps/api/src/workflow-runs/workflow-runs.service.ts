import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  WorkflowRunRepository,
  WorkflowRunRepositoryError,
} from '@tasktwin/database';
import {
  CreateWorkflowRunRequestSchema,
  WorkflowRunCancellationRequestSchema,
} from '@tasktwin/run-protocol';

import {
  cancellationResponse,
  createResponse,
  detailResponse,
  listResponse,
} from './workflow-run-response.mapper.js';

function rethrow(error: unknown): never {
  if (!(error instanceof WorkflowRunRepositoryError)) {
    throw error;
  }
  switch (error.code) {
    case 'RUN_NOT_FOUND':
    case 'RUNNER_MISMATCH':
      throw new NotFoundException();
    case 'RUN_FORBIDDEN':
      throw new ForbiddenException();
    case 'RUN_NOT_READY':
      throw new ConflictException({
        code: 'RUN_NOT_READY',
        message: 'The workflow version is not ready for local dispatch.',
        ...(error.readiness === undefined
          ? {}
          : { readiness: error.readiness }),
      });
    case 'SERIALIZATION_FAILURE':
      throw new ServiceUnavailableException({
        code: 'TEMPORARILY_UNAVAILABLE',
        message: 'The run operation could not be serialized.',
      });
    default:
      throw new ConflictException({
        code: error.code,
        message: 'The run operation conflicts with current state.',
      });
  }
}

@Injectable()
export class WorkflowRunsService {
  constructor(private readonly repository: WorkflowRunRepository) {}

  async create(actorUserId: string, workflowVersionId: string, input: unknown) {
    const request = CreateWorkflowRunRequestSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException('Invalid workflow run request.');
    }
    try {
      return createResponse(
        await this.repository.createRun({
          actorUserId,
          workflowVersionId,
          runnerDeviceId: request.data.runnerDeviceId,
          clientRunId: request.data.clientRunId,
        }),
      );
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async cancel(actorUserId: string, workflowRunId: string, input: unknown) {
    if (!WorkflowRunCancellationRequestSchema.safeParse(input).success) {
      throw new BadRequestException('Invalid cancellation request.');
    }
    try {
      return cancellationResponse(
        await this.repository.cancel(actorUserId, workflowRunId, new Date()),
      );
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async list(actorUserId: string, workspaceId: string) {
    const result = await this.repository.listRuns(
      actorUserId,
      workspaceId,
      new Date(),
    );
    if (result === null) {
      throw new NotFoundException();
    }
    return listResponse(result);
  }

  async detail(actorUserId: string, workflowRunId: string) {
    const result = await this.repository.getRun(
      actorUserId,
      workflowRunId,
      new Date(),
    );
    if (result === null) {
      throw new NotFoundException();
    }
    return detailResponse(result);
  }
}
