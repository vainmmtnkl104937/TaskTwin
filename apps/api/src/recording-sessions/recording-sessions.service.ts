import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  RecordingRepository,
  RecordingRepositoryError,
} from '@tasktwin/database';
import {
  RecordingEventBatchSchema,
  RecordingSessionCompleteRequestSchema,
  RecordingSessionCreateRequestSchema,
  type RecordingEventBatchResponse,
  type RecordingSessionCompleteResponse,
  type RecordingSessionCreateResponse,
  type RecordingSessionMetadataResponse,
} from '@tasktwin/recording-schema';

import {
  toRecordingEventBatchResponse,
  toRecordingSessionCompleteResponse,
  toRecordingSessionCreateResponse,
  toRecordingSessionMetadataResponse,
} from './recording-response.mapper.js';

function rethrowRepositoryError(error: unknown): never {
  if (!(error instanceof RecordingRepositoryError)) {
    throw error;
  }

  switch (error.code) {
    case 'INVALID_RECORDING_INPUT':
      throw new BadRequestException(error.message);
    case 'WORKSPACE_NOT_FOUND':
    case 'RECORDING_NOT_FOUND':
      throw new NotFoundException();
    case 'RECORDING_CONFLICT':
    case 'BATCH_CONFLICT':
    case 'SESSION_COMPLETED':
    case 'INCOMPLETE_RECORDING':
      throw new ConflictException(error.message);
    case 'SERIALIZATION_FAILURE':
      throw new ServiceUnavailableException(error.message);
    case 'PERSISTED_RECORDING_INVALID':
      throw new InternalServerErrorException(
        'Stored recording data is unavailable.',
      );
  }
}

@Injectable()
export class RecordingSessionsService {
  constructor(private readonly recordingRepository: RecordingRepository) {}

  async create(
    actorUserId: string,
    workspaceId: string,
    input: unknown,
  ): Promise<RecordingSessionCreateResponse> {
    const parsed = RecordingSessionCreateRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException('The recording input is invalid.');
    }

    try {
      return toRecordingSessionCreateResponse(
        await this.recordingRepository.createSession(
          actorUserId,
          workspaceId,
          parsed.data,
        ),
      );
    } catch (error: unknown) {
      rethrowRepositoryError(error);
    }
  }

  async ingestBatch(
    actorUserId: string,
    recordingSessionId: string,
    input: unknown,
  ): Promise<RecordingEventBatchResponse> {
    const parsed = RecordingEventBatchSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException('The recording batch is invalid.');
    }

    try {
      return toRecordingEventBatchResponse(
        await this.recordingRepository.ingestBatch(
          actorUserId,
          recordingSessionId,
          parsed.data,
        ),
      );
    } catch (error: unknown) {
      rethrowRepositoryError(error);
    }
  }

  async complete(
    actorUserId: string,
    recordingSessionId: string,
    input: unknown,
  ): Promise<RecordingSessionCompleteResponse> {
    const parsed = RecordingSessionCompleteRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException(
        'The recording completion request is invalid.',
      );
    }

    try {
      return toRecordingSessionCompleteResponse(
        await this.recordingRepository.completeSession(
          actorUserId,
          recordingSessionId,
          parsed.data,
        ),
      );
    } catch (error: unknown) {
      rethrowRepositoryError(error);
    }
  }

  async getMetadata(
    actorUserId: string,
    recordingSessionId: string,
  ): Promise<RecordingSessionMetadataResponse> {
    try {
      const record = await this.recordingRepository.getSessionMetadata(
        actorUserId,
        recordingSessionId,
      );
      if (record === null) {
        throw new NotFoundException();
      }
      return toRecordingSessionMetadataResponse(record);
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      rethrowRepositoryError(error);
    }
  }
}
