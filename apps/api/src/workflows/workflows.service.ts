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
  WorkflowDraftRepository,
  WorkflowDraftRepositoryError,
} from '@tasktwin/database';
import { validateEditorWorkflow } from '@tasktwin/workflow-editor-core';

import {
  UpdateWorkflowDraftRequestSchema,
  type WorkflowVersionDetailResponse,
  type WorkspaceWorkflowListResponse,
} from './workflow.contracts.js';
import {
  toWorkflowVersionDetailResponse,
  toWorkspaceWorkflowListResponse,
} from './workflow-response.mapper.js';

function rethrowRepositoryError(error: unknown): never {
  if (!(error instanceof WorkflowDraftRepositoryError)) {
    throw error;
  }

  switch (error.code) {
    case 'WORKSPACE_NOT_FOUND':
    case 'WORKFLOW_VERSION_NOT_FOUND':
      throw new NotFoundException();
    case 'WORKFLOW_DRAFT_FORBIDDEN':
      throw new ForbiddenException();
    case 'WORKFLOW_VERSION_NOT_DRAFT':
      throw new ConflictException({
        code: 'WORKFLOW_VERSION_NOT_DRAFT',
        message: 'Only draft workflow versions can be edited.',
      });
    case 'WORKFLOW_DRAFT_REVISION_CONFLICT':
      throw new ConflictException({
        code: 'WORKFLOW_DRAFT_REVISION_CONFLICT',
        message: 'The draft has changed. Reload before saving.',
        ...(error.currentRevision === undefined
          ? {}
          : { currentRevision: error.currentRevision }),
      });
    case 'WORKFLOW_ID_IMMUTABLE':
    case 'WORKFLOW_VERSION_IMMUTABLE':
    case 'WORKFLOW_SCHEMA_VERSION_IMMUTABLE':
    case 'WORKFLOW_STATUS_INVALID':
      throw new BadRequestException({
        code: error.code,
        message: 'Immutable workflow version fields cannot be changed.',
      });
    case 'WORKFLOW_DEFINITION_INVALID':
      throw new BadRequestException({
        code: 'WORKFLOW_DEFINITION_INVALID',
        message: 'The workflow definition is invalid.',
      });
    case 'SERIALIZATION_FAILURE':
      throw new ServiceUnavailableException({
        code: 'WORKFLOW_DRAFT_SERIALIZATION_FAILURE',
        message: 'The workflow draft could not be saved safely.',
      });
    case 'PERSISTED_WORKFLOW_INVALID':
      throw new InternalServerErrorException(
        'Stored workflow data is unavailable.',
      );
  }
}

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly workflowDraftRepository: WorkflowDraftRepository,
  ) {}

  async list(
    actorUserId: string,
    workspaceId: string,
  ): Promise<WorkspaceWorkflowListResponse> {
    const record = await this.workflowDraftRepository.listForWorkspace(
      actorUserId,
      workspaceId,
    );
    if (record === null) {
      throw new NotFoundException();
    }

    return toWorkspaceWorkflowListResponse(record);
  }

  async getVersion(
    actorUserId: string,
    workflowVersionId: string,
  ): Promise<WorkflowVersionDetailResponse> {
    try {
      const record = await this.workflowDraftRepository.getVersion(
        actorUserId,
        workflowVersionId,
      );
      if (record === null) {
        throw new NotFoundException();
      }
      return toWorkflowVersionDetailResponse(record);
    } catch (error: unknown) {
      rethrowRepositoryError(error);
    }
  }

  async updateDraft(
    actorUserId: string,
    workflowVersionId: string,
    input: unknown,
  ): Promise<WorkflowVersionDetailResponse> {
    const request = UpdateWorkflowDraftRequestSchema.safeParse(input);
    if (
      !request.success ||
      validateEditorWorkflow(request.success ? request.data.definition : input)
        .length > 0
    ) {
      throw new BadRequestException({
        code: 'WORKFLOW_DEFINITION_INVALID',
        message: 'The workflow draft request is invalid.',
      });
    }

    try {
      const result = await this.workflowDraftRepository.updateDraft(
        actorUserId,
        workflowVersionId,
        request.data.expectedRevision,
        request.data.definition,
      );
      return toWorkflowVersionDetailResponse(result.workflowVersion);
    } catch (error: unknown) {
      rethrowRepositoryError(error);
    }
  }
}
