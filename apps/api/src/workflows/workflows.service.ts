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
import { analyzeWorkflowInputs } from '@tasktwin/workflow-inputs';

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
    case 'WORKFLOW_POLICY_BLOCKED':
      throw new BadRequestException({
        code: error.code,
        message: 'The workflow is blocked by the active execution policy.',
        ...(error.readiness === undefined
          ? {}
          : { readiness: error.readiness }),
      });
    case 'WORKFLOW_POLICY_MISSING':
      throw new InternalServerErrorException({
        code: error.code,
        message: 'The Workspace execution policy is unavailable.',
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
    const definitionInput =
      typeof input === 'object' && input !== null && 'definition' in input
        ? input.definition
        : input;
    const inputAnalysis = analyzeWorkflowInputs(definitionInput);
    const editorIssues = request.success
      ? validateEditorWorkflow(request.data.definition)
      : [];
    const validationIssues = [
      ...inputAnalysis.issues
        .filter((issue) => issue.severity === 'blocking')
        .map((issue) => ({
          code: issue.code,
          message: issue.message,
          path: issue.path,
          ...(issue.stepId === undefined ? {} : { stepId: issue.stepId }),
          ...(issue.stepIndex === undefined
            ? {}
            : { stepIndex: issue.stepIndex }),
          ...(issue.variableName === undefined
            ? {}
            : { variableName: issue.variableName }),
        })),
      ...editorIssues
        .filter(
          (issue) =>
            !inputAnalysis.issues.some(
              (inputIssue) =>
                inputIssue.code === issue.code &&
                JSON.stringify(inputIssue.path) === JSON.stringify(issue.path),
            ),
        )
        .map((issue) => ({
          code: issue.code,
          message: issue.message,
          path: issue.path,
          ...(issue.stepId === undefined ? {} : { stepId: issue.stepId }),
          ...(issue.stepIndex === undefined
            ? {}
            : { stepIndex: issue.stepIndex }),
        })),
    ];
    if (!request.success || validationIssues.length > 0) {
      if (validationIssues.length > 0) {
        throw new BadRequestException({
          code: 'WORKFLOW_INPUT_VALIDATION_FAILED',
          message: 'The workflow contains invalid input references.',
          issues: validationIssues,
        });
      }
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
