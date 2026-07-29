import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  RecordingRepository,
  RecordingRepositoryError,
  RecordingWorkflowConversionRepository,
  RecordingWorkflowConversionRepositoryError,
  type CompletedRecordingArtifactRecord,
  type CreateRecordingWorkflowConversionResult,
} from '@tasktwin/database';
import {
  convertRecordingArtifact,
  RecordingConversionOptionsSchema,
  type WorkflowDraftConversionResult,
} from '@tasktwin/recording-converter';

import {
  CreateRecordingWorkflowDraftRequestSchema,
  type RecordingWorkflowDraftResponse,
} from './recording-workflow-draft.contracts.js';
import { toRecordingWorkflowDraftResponse } from './recording-workflow-draft-response.mapper.js';

function rethrowRecordingError(error: unknown): never {
  if (!(error instanceof RecordingRepositoryError)) {
    throw error;
  }

  switch (error.code) {
    case 'RECORDING_NOT_FOUND':
      throw new NotFoundException();
    case 'RECORDING_NOT_COMPLETED':
      throw new ConflictException(
        'The recording session must be completed before conversion.',
      );
    case 'PERSISTED_RECORDING_INVALID':
      throw new InternalServerErrorException(
        'Stored recording data is unavailable.',
      );
    case 'SERIALIZATION_FAILURE':
      throw new ServiceUnavailableException(
        'The recording operation could not be serialized.',
      );
    default:
      throw new InternalServerErrorException(
        'The recording could not be converted.',
      );
  }
}

function rethrowConversionRepositoryError(error: unknown): never {
  if (!(error instanceof RecordingWorkflowConversionRepositoryError)) {
    throw error;
  }

  switch (error.code) {
    case 'RECORDING_NOT_FOUND':
      throw new NotFoundException();
    case 'RECORDING_NOT_COMPLETED':
      throw new ConflictException(
        'The recording session must be completed before conversion.',
      );
    case 'CONVERSION_CONFLICT':
      throw new ConflictException(
        'The workflow draft conversion conflicts with stored data.',
      );
    case 'SERIALIZATION_FAILURE':
      throw new ServiceUnavailableException(
        'The workflow draft conversion could not be serialized.',
      );
    case 'INVALID_CONVERSION_INPUT':
    case 'PERSISTED_CONVERSION_INVALID':
      throw new InternalServerErrorException(
        'The workflow draft conversion is unavailable.',
      );
  }
}

@Injectable()
export class RecordingWorkflowDraftsService {
  constructor(
    private readonly recordingRepository: RecordingRepository,
    private readonly conversionRepository: RecordingWorkflowConversionRepository,
  ) {}

  async create(
    actorUserId: string,
    recordingSessionId: string,
    input: unknown,
  ): Promise<RecordingWorkflowDraftResponse> {
    const request = CreateRecordingWorkflowDraftRequestSchema.safeParse(input);
    if (!request.success) {
      throw new BadRequestException(
        'The workflow draft conversion request is invalid.',
      );
    }

    let source: CompletedRecordingArtifactRecord;
    try {
      source = await this.recordingRepository.getCompletedArtifactForConversion(
        actorUserId,
        recordingSessionId,
      );
    } catch (error: unknown) {
      rethrowRecordingError(error);
    }

    const options = RecordingConversionOptionsSchema.parse({
      schemaVersion: 1,
      workflowId: `workflow-${randomUUID()}`,
      workflowName: request.data.name,
      ...(request.data.description === undefined
        ? {}
        : { description: request.data.description }),
    });

    let conversion: WorkflowDraftConversionResult;
    try {
      conversion = convertRecordingArtifact(source.artifact, options);
    } catch {
      throw new InternalServerErrorException(
        'Stored recording data is unavailable.',
      );
    }

    if (conversion.outcome === 'no-executable-steps') {
      throw new UnprocessableEntityException(
        'The recording does not contain an executable workflow step.',
      );
    }

    let persisted: CreateRecordingWorkflowConversionResult;
    try {
      persisted = await this.conversionRepository.createDraft(
        actorUserId,
        recordingSessionId,
        request.data.clientConversionId,
        options,
        conversion,
      );
    } catch (error: unknown) {
      rethrowConversionRepositoryError(error);
    }

    try {
      return toRecordingWorkflowDraftResponse(persisted);
    } catch {
      throw new InternalServerErrorException(
        'The workflow draft conversion is unavailable.',
      );
    }
  }
}
