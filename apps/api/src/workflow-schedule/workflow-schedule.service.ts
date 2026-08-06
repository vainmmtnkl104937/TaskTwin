import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  WorkflowScheduleRepository,
  WorkflowScheduleRepositoryError,
} from '@tasktwin/database';

import {
  CreateWorkflowScheduleRequestSchema,
  type OccurrenceListResponse,
  type WorkflowScheduleListResponse,
  type WorkflowScheduleResponse,
} from './workflow-schedule.contracts.js';
import {
  toOccurrenceListResponse,
  toWorkflowScheduleListResponse,
  toWorkflowScheduleResponse,
} from './workflow-schedule-response.mapper.js';

function rethrow(error: unknown): never {
  if (!(error instanceof WorkflowScheduleRepositoryError)) throw error;
  switch (error.code) {
    case 'SCHEDULE_NOT_FOUND':
      throw new NotFoundException({
        code: error.code,
        message: 'Schedule not found.',
      });
    case 'SCHEDULE_FORBIDDEN':
      throw new ForbiddenException({
        code: error.code,
        message: 'You do not have permission to access this schedule.',
      });
    case 'SCHEDULE_IDEMPOTENCY_CONFLICT':
      throw new ConflictException({
        code: error.code,
        message: 'A schedule with the same client ID already exists with different content.',
      });
    case 'SCHEDULE_VERSION_UNAVAILABLE':
      throw new BadRequestException({
        code: error.code,
        message: 'The workflow version is not available.',
      });
    case 'SCHEDULE_RUNNER_MISMATCH':
      throw new BadRequestException({
        code: error.code,
        message: 'The runner device is not available in this workspace.',
      });
    case 'SCHEDULE_RUNNER_REVOKED':
      throw new BadRequestException({
        code: error.code,
        message: 'The runner device has been revoked.',
      });
    case 'SCHEDULE_POLICY_DENIED':
      throw new ForbiddenException({
        code: error.code,
        message: 'The workflow is not allowed to run on this runner due to policy.',
      });
    case 'SCHEDULE_NOT_READY': {
      const issues = error.details as unknown[] | undefined;
      throw new BadRequestException({
        code: error.code,
        message: 'The schedule is not ready to run.',
        readinessIssues: issues ?? [],
      });
    }
    case 'SCHEDULE_COMPLETED':
      throw new ConflictException({
        code: error.code,
        message: 'Cannot modify a completed schedule.',
      });
    case 'SCHEDULE_ARCHIVED':
      throw new ConflictException({
        code: error.code,
        message: 'Cannot resume an archived schedule.',
      });
    case 'SCHEDULE_NOT_PAUSED':
      throw new ConflictException({
        code: error.code,
        message: 'Schedule is not paused.',
      });
    case 'SCHEDULE_CANNOT_RESUME':
      throw new ConflictException({
        code: error.code,
        message: 'Schedule cannot be resumed in its current state.',
      });
    case 'SCHEDULE_UNATTENDED_NOT_SUPPORTED':
      throw new BadRequestException({
        code: error.code,
        message: 'The workflow does not support unattended execution.',
      });
    case 'OCCURRENCE_DUPLICATE':
      throw new ConflictException({
        code: error.code,
        message: 'An occurrence for this time already exists.',
      });
    case 'OCCURRENCE_NOT_FOUND':
      throw new NotFoundException({
        code: error.code,
        message: 'Occurrence not found.',
      });
    case 'OCCURRENCE_INVALID':
      throw new BadRequestException({
        code: error.code,
        message: 'The occurrence data is invalid.',
      });
    case 'RUNNER_NOT_CAPABLE':
      throw new BadRequestException({
        code: error.code,
        message: 'The runner is not capable of running this workflow.',
      });
    case 'RUNNER_BUSY':
      throw new ConflictException({
        code: error.code,
        message: 'The runner is currently busy.',
      });
    case 'SCHEDULER_CONFLICT':
      throw new ConflictException({
        code: error.code,
        message: 'Another scheduler operation is in progress.',
      });
    case 'SERIALIZATION_FAILURE':
      throw new InternalServerErrorException({
        code: error.code,
        message: 'A serialization conflict occurred. Please retry.',
      });
    default:
      throw new InternalServerErrorException({
        code: error.code,
        message: 'An unexpected error occurred.',
      });
  }
}

@Injectable()
export class WorkflowScheduleService {
  constructor(private readonly repository: WorkflowScheduleRepository) {}

  async create(
    userId: string,
    workflowVersionId: string,
    input: unknown,
  ): Promise<WorkflowScheduleResponse> {
    const request = CreateWorkflowScheduleRequestSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException({
        code: 'SCHEDULE_INVALID',
        message: 'The schedule request is invalid.',
        errors: request.error.flatten(),
      });
    }

    try {
      const result = await this.repository.create({
        actorUserId: userId,
        workflowVersionId,
        clientScheduleId: request.data.clientScheduleId,
        name: request.data.name,
        definition: request.data.definition,
        runnerDeviceId: request.data.runnerDeviceId,
        maxStartDelaySeconds: request.data.maxStartDelaySeconds,
        now: new Date(),
      });
      return toWorkflowScheduleResponse(result);
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async getById(
    userId: string,
    scheduleId: string,
  ): Promise<WorkflowScheduleResponse> {
    try {
      const result = await this.repository.getById(userId, scheduleId);
      if (result === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_NOT_FOUND');
      }
      return toWorkflowScheduleResponse({
        schedule: result.schedule,
        nextOccurrenceAt: result.schedule.nextOccurrenceAt,
        idempotent: false,
        ready: true,
        readinessIssues: [],
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async listByWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<WorkflowScheduleListResponse> {
    try {
      const result = await this.repository.listByWorkspace(userId, workspaceId, new Date());
      if (result === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_FORBIDDEN');
      }
      return toWorkflowScheduleListResponse(result.schedules, result.access);
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async getOccurrences(
    userId: string,
    scheduleId: string,
    limit: number,
    beforeCursor?: string,
  ): Promise<OccurrenceListResponse> {
    const effectiveLimit = Math.min(Math.max(1, limit), 100);
    try {
      const result = await this.repository.getOccurrences(
        userId,
        scheduleId,
        effectiveLimit,
        beforeCursor,
      );
      if (result === null) {
        throw new WorkflowScheduleRepositoryError('SCHEDULE_FORBIDDEN');
      }
      return toOccurrenceListResponse(
        scheduleId,
        result.occurrences,
        result.nextCursor,
      );
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async pause(
    userId: string,
    scheduleId: string,
  ): Promise<WorkflowScheduleResponse> {
    try {
      const schedule = await this.repository.pause(userId, scheduleId, new Date());
      return toWorkflowScheduleResponse({
        schedule,
        nextOccurrenceAt: schedule.nextOccurrenceAt,
        idempotent: false,
        ready: true,
        readinessIssues: [],
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async resume(
    userId: string,
    scheduleId: string,
  ): Promise<WorkflowScheduleResponse> {
    try {
      const schedule = await this.repository.resume(userId, scheduleId, new Date());
      return toWorkflowScheduleResponse({
        schedule,
        nextOccurrenceAt: schedule.nextOccurrenceAt,
        idempotent: false,
        ready: true,
        readinessIssues: [],
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async archive(
    userId: string,
    scheduleId: string,
  ): Promise<WorkflowScheduleResponse> {
    try {
      const schedule = await this.repository.archive(userId, scheduleId, new Date());
      return toWorkflowScheduleResponse({
        schedule,
        nextOccurrenceAt: schedule.nextOccurrenceAt,
        idempotent: false,
        ready: true,
        readinessIssues: [],
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }
}
