import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  createCanonicalJsonDigest,
  RunnerRolloutRepository,
  RunnerRolloutRepositoryError,
} from '@tasktwin/database';
import {
  RunnerRolloutError,
  validateRolloutPlan,
} from '@tasktwin/runner-rollout';

import {
  CreateRunnerRolloutRequestSchema,
  RunnerRolloutListQuerySchema,
  StageNumberSchema,
} from './runner-rollout.contracts.js';
import {
  decodeTimeIdCursor,
  encodeTimeIdCursor,
} from '../common/time-id-cursor.js';

function rethrow(error: unknown): never {
  if (error instanceof RunnerRolloutError) {
    throw new BadRequestException({ code: error.code, message: error.message });
  }
  if (!(error instanceof RunnerRolloutRepositoryError)) throw error;
  switch (error.code) {
    case 'ROLLOUT_NOT_FOUND':
    case 'STAGE_NOT_FOUND':
      throw new NotFoundException({ code: error.code });
    case 'ROLLOUT_FORBIDDEN':
      throw new ForbiddenException({ code: error.code });
    case 'ROLLOUT_IDEMPOTENCY_CONFLICT':
    case 'RUNNER_ACTIVE_ROLLOUT_CONFLICT':
    case 'INVALID_STATE_TRANSITION':
    case 'STAGE_OUT_OF_ORDER':
    case 'SERIALIZATION_FAILURE':
      throw new ConflictException({ code: error.code });
    case 'RELEASE_NOT_AVAILABLE':
    case 'RUNNER_WORKSPACE_MISMATCH':
    case 'RUNNER_REVOKED':
    case 'RUNNER_PLATFORM_INCOMPATIBLE':
      throw new BadRequestException({ code: error.code });
  }
}

@Injectable()
export class RunnerRolloutService {
  constructor(private readonly repository: RunnerRolloutRepository) {}

  async create(actorUserId: string, workspaceId: string, rawInput: unknown) {
    const parsed = CreateRunnerRolloutRequestSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'ROLLOUT_INVALID' });
    }
    const plan = {
      workspaceId,
      targetReleaseId: parsed.data.targetReleaseId,
      stages: parsed.data.stages,
    };
    try {
      validateRolloutPlan(plan);
      return await this.repository.create({
        actorUserId,
        clientRolloutId: parsed.data.clientRolloutId,
        requestDigest: createCanonicalJsonDigest(plan),
        plan,
      });
    } catch (error: unknown) {
      rethrow(error);
    }
  }

  async list(
    actorUserId: string,
    workspaceId: string,
    rawQuery: { limit?: string; cursor?: string } = {},
  ) {
    const query = RunnerRolloutListQuerySchema.safeParse(rawQuery);
    if (!query.success)
      throw new BadRequestException({ code: 'ROLLOUT_INVALID' });
    let cursor: ReturnType<typeof decodeTimeIdCursor> | undefined;
    try {
      cursor =
        query.data.cursor === undefined
          ? undefined
          : decodeTimeIdCursor(query.data.cursor);
    } catch {
      throw new BadRequestException({ code: 'ROLLOUT_INVALID_CURSOR' });
    }
    const result = await this.repository.list(actorUserId, workspaceId, {
      limit: query.data.limit,
      ...(cursor === undefined
        ? {}
        : { cursor: { createdAt: cursor.time, id: cursor.id } }),
    });
    if (result === null) throw new NotFoundException();
    return {
      ...result,
      nextCursor:
        result.nextCursor === null
          ? null
          : encodeTimeIdCursor({
              time: result.nextCursor.createdAt,
              id: result.nextCursor.id,
            }),
    };
  }

  async get(actorUserId: string, rolloutId: string) {
    const result = await this.repository.get(actorUserId, rolloutId);
    if (result === null) throw new NotFoundException();
    return result;
  }

  activate(actorUserId: string, rolloutId: string) {
    return this.repository.activate(actorUserId, rolloutId).catch(rethrow);
  }

  pause(actorUserId: string, rolloutId: string) {
    return this.repository.pause(actorUserId, rolloutId).catch(rethrow);
  }

  cancel(actorUserId: string, rolloutId: string) {
    return this.repository.cancel(actorUserId, rolloutId).catch(rethrow);
  }

  activateStage(
    actorUserId: string,
    rolloutId: string,
    rawStageNumber: string,
  ) {
    const stageNumber = StageNumberSchema.safeParse(rawStageNumber);
    if (!stageNumber.success) throw new BadRequestException();
    return this.repository
      .activateStage({ actorUserId, rolloutId, stageNumber: stageNumber.data })
      .catch(rethrow);
  }
}
