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
  SecureRunInputRepository,
  SecureRunInputRepositoryError,
} from '@tasktwin/database';
import {
  CommitRunInputPreparationRequestSchema,
  CreateRunInputPreparationRequestSchema,
  CreateWorkflowRunResponseSchema,
  CreateWorkflowRunRequestSchema,
  RunInputPreparationResponseSchema,
  UuidSchema,
  WorkflowRunCancellationRequestSchema,
} from '@tasktwin/run-protocol';
import { z } from 'zod';

import {
  cancellationResponse,
  createResponse,
  detailResponse,
  listResponse,
  safeRun,
} from './workflow-run-response.mapper.js';
import {
  decodeTimeIdCursor,
  encodeTimeIdCursor,
} from '../common/time-id-cursor.js';

const WorkflowRunListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
});

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
  constructor(
    private readonly repository: WorkflowRunRepository,
    private readonly secureInputs?: SecureRunInputRepository,
  ) {}

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
          options: request.data.options,
        }),
      );
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async prepareInputs(
    actorUserId: string,
    workflowVersionId: string,
    input: unknown,
  ) {
    const request = CreateRunInputPreparationRequestSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException('Invalid run input preparation request.');
    }
    if (this.secureInputs === undefined) {
      throw new ServiceUnavailableException();
    }
    try {
      const result = await this.secureInputs.prepare({
        actorUserId,
        workflowVersionId,
        ...request.data,
        now: new Date(),
      });
      return RunInputPreparationResponseSchema.parse({
        schemaVersion: 1,
        ...result,
      });
    } catch (error: unknown) {
      this.rethrowSecure(error);
    }
  }

  async commitInputs(
    actorUserId: string,
    preparationId: string,
    input: unknown,
  ) {
    if (!UuidSchema.safeParse(preparationId).success) {
      throw new BadRequestException('Invalid secure input preparation.');
    }
    const request = CommitRunInputPreparationRequestSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException('Invalid encrypted run input envelope.');
    }
    if (this.secureInputs === undefined) {
      throw new ServiceUnavailableException();
    }
    try {
      const result = await this.secureInputs.commit({
        actorUserId,
        preparationId,
        envelope: request.data.envelope,
        now: new Date(),
      });
      const stored = await this.repository.getRun(
        actorUserId,
        result.workflowRunId,
        new Date(),
      );
      if (stored === null) {
        throw new NotFoundException();
      }
      return CreateWorkflowRunResponseSchema.parse({
        schemaVersion: 1,
        idempotent: result.idempotent,
        run: safeRun(stored.run),
      });
    } catch (error: unknown) {
      this.rethrowSecure(error);
    }
  }

  private rethrowSecure(error: unknown): never {
    if (!(error instanceof SecureRunInputRepositoryError)) {
      throw error;
    }
    switch (error.code) {
      case 'NOT_FOUND':
      case 'RUNNER_UNAVAILABLE':
        throw new NotFoundException();
      case 'FORBIDDEN':
        throw new ForbiddenException();
      case 'RUN_NOT_READY':
      case 'CAPABILITY_UNAVAILABLE':
      case 'PREPARATION_EXPIRED':
      case 'PREPARATION_CONFLICT':
      case 'ENVELOPE_INVALID':
      case 'KEY_CONFLICT':
        throw new ConflictException({
          code: error.code,
          message:
            'The secure run input operation conflicts with current state.',
        });
      case 'SERIALIZATION_FAILURE':
        throw new ServiceUnavailableException();
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

  async list(
    actorUserId: string,
    workspaceId: string,
    rawQuery: { limit?: string; cursor?: string } = {},
  ) {
    const query = WorkflowRunListQuerySchema.safeParse(rawQuery);
    if (!query.success)
      throw new BadRequestException('Invalid run list query.');
    let cursor: ReturnType<typeof decodeTimeIdCursor> | undefined;
    try {
      cursor =
        query.data.cursor === undefined
          ? undefined
          : decodeTimeIdCursor(query.data.cursor);
    } catch {
      throw new BadRequestException('Invalid run list cursor.');
    }
    const result = await this.repository.listRuns(actorUserId, workspaceId, {
      limit: query.data.limit,
      ...(cursor === undefined
        ? {}
        : { cursor: { createdAt: cursor.time, id: cursor.id } }),
    });
    if (result === null) {
      throw new NotFoundException();
    }
    return listResponse(
      result,
      result.nextCursor === null
        ? null
        : encodeTimeIdCursor({
            time: result.nextCursor.createdAt,
            id: result.nextCursor.id,
          }),
    );
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
