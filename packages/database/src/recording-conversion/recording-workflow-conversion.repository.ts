import {
  RecordingConversionOptionsSchema,
  RecordingConversionReportSchema,
  WorkflowDraftConversionResultSchema,
} from '@tasktwin/recording-converter';
import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';

import {
  OrganizationRole,
  Prisma,
  type PrismaClient,
} from '../generated/prisma/client.js';
import { RecordingWorkflowConversionRepositoryError } from './recording-workflow-conversion-errors.js';
import type {
  CreateRecordingWorkflowConversionResult,
  RecordingWorkflowConversionRecord,
} from './recording-workflow-conversion-records.js';

const MAX_SERIALIZABLE_ATTEMPTS = 3;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONVERSION_ROLES = [
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
  OrganizationRole.MEMBER,
] as const;

const conversionSelect = {
  id: true,
  recordingSessionId: true,
  clientConversionId: true,
  workflowId: true,
  workflowVersionId: true,
  createdById: true,
  conversionReport: true,
  createdAt: true,
  workflowVersion: {
    select: {
      id: true,
      workflowId: true,
      version: true,
      status: true,
      schemaVersion: true,
      definition: true,
    },
  },
  workflow: {
    select: {
      workspaceId: true,
    },
  },
  recordingSession: {
    select: {
      clientSessionId: true,
      eventCount: true,
      status: true,
      workspaceId: true,
    },
  },
} as const;

type ConversionRow = Prisma.RecordingWorkflowConversionGetPayload<{
  select: typeof conversionSelect;
}>;

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function toConversionRecord(
  row: ConversionRow,
): RecordingWorkflowConversionRecord {
  const report = RecordingConversionReportSchema.safeParse(
    row.conversionReport,
  );
  const workflowDefinition = WorkflowDefinitionSchema.safeParse(
    row.workflowVersion.definition,
  );
  const result =
    report.success && workflowDefinition.success
      ? WorkflowDraftConversionResultSchema.safeParse({
          schemaVersion: 1,
          outcome: 'draft',
          workflowDefinition: workflowDefinition.data,
          report: report.data,
        })
      : null;
  if (
    !report.success ||
    !workflowDefinition.success ||
    result === null ||
    !result.success ||
    row.workflowVersion.id !== row.workflowVersionId ||
    row.workflowVersion.workflowId !== row.workflowId ||
    row.workflowVersion.version !== 1 ||
    row.workflowVersion.schemaVersion !==
      workflowDefinition.data.schemaVersion ||
    workflowDefinition.data.workflowId !== row.workflowId ||
    workflowDefinition.data.version !== 1 ||
    workflowDefinition.data.status !== 'draft' ||
    row.recordingSession.status !== 'completed' ||
    row.recordingSession.clientSessionId !==
      report.data.sourceClientSessionId ||
    row.recordingSession.eventCount !== report.data.sourceEventCount ||
    row.recordingSession.workspaceId !== row.workflow.workspaceId
  ) {
    throw new RecordingWorkflowConversionRepositoryError(
      'PERSISTED_CONVERSION_INVALID',
    );
  }

  return {
    id: row.id,
    recordingSessionId: row.recordingSessionId,
    clientConversionId: row.clientConversionId,
    workflowId: row.workflowId,
    workflowVersionId: row.workflowVersionId,
    createdById: row.createdById,
    report: report.data,
    workflowDefinition: workflowDefinition.data,
    createdAt: row.createdAt,
  };
}

function hasMatchingRequest(
  conversion: RecordingWorkflowConversionRecord,
  requestedDefinition: ReturnType<typeof WorkflowDefinitionSchema.parse>,
): boolean {
  return (
    conversion.workflowDefinition.name === requestedDefinition.name &&
    conversion.workflowDefinition.description ===
      requestedDefinition.description
  );
}

export class RecordingWorkflowConversionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createDraft(
    actorUserId: string,
    recordingSessionId: string,
    clientConversionId: string,
    optionsInput: unknown,
    resultInput: unknown,
  ): Promise<CreateRecordingWorkflowConversionResult> {
    const options = RecordingConversionOptionsSchema.safeParse(optionsInput);
    const result = WorkflowDraftConversionResultSchema.safeParse(resultInput);
    if (
      !UUID_PATTERN.test(actorUserId) ||
      !UUID_PATTERN.test(recordingSessionId) ||
      !UUID_PATTERN.test(clientConversionId) ||
      !options.success ||
      !result.success ||
      result.data.outcome !== 'draft'
    ) {
      throw new RecordingWorkflowConversionRepositoryError(
        'INVALID_CONVERSION_INPUT',
      );
    }

    const workflowDefinition = WorkflowDefinitionSchema.safeParse(
      result.data.workflowDefinition,
    );
    const report = RecordingConversionReportSchema.safeParse(
      result.data.report,
    );
    if (
      !workflowDefinition.success ||
      !report.success ||
      workflowDefinition.data.workflowId !== options.data.workflowId ||
      workflowDefinition.data.name !== options.data.workflowName ||
      workflowDefinition.data.description !== options.data.description ||
      workflowDefinition.data.version !== 1 ||
      workflowDefinition.data.status !== 'draft'
    ) {
      throw new RecordingWorkflowConversionRepositoryError(
        'INVALID_CONVERSION_INPUT',
      );
    }

    const operation = (
      transaction: Prisma.TransactionClient,
    ): Promise<CreateRecordingWorkflowConversionResult> =>
      this.createDraftInTransaction(
        transaction,
        actorUserId,
        recordingSessionId,
        clientConversionId,
        workflowDefinition.data,
        report.data,
      );

    try {
      return await this.runSerializable(operation);
    } catch (error: unknown) {
      if (!isPrismaErrorCode(error, 'P2002')) {
        throw error;
      }

      const existing = await this.findAccessibleExisting(
        actorUserId,
        recordingSessionId,
        clientConversionId,
      );
      if (existing !== null) {
        if (!hasMatchingRequest(existing, workflowDefinition.data)) {
          throw new RecordingWorkflowConversionRepositoryError(
            'CONVERSION_CONFLICT',
          );
        }
        return { conversion: existing, idempotent: true };
      }

      throw new RecordingWorkflowConversionRepositoryError(
        'CONVERSION_CONFLICT',
      );
    }
  }

  private async createDraftInTransaction(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    recordingSessionId: string,
    clientConversionId: string,
    workflowDefinition: ReturnType<typeof WorkflowDefinitionSchema.parse>,
    report: ReturnType<typeof RecordingConversionReportSchema.parse>,
  ): Promise<CreateRecordingWorkflowConversionResult> {
    const recording = await transaction.recordingSession.findFirst({
      where: {
        id: recordingSessionId,
        workspace: {
          organization: {
            members: {
              some: {
                userId: actorUserId,
                role: { in: [...CONVERSION_ROLES] },
              },
            },
          },
        },
      },
      select: {
        id: true,
        workspaceId: true,
        clientSessionId: true,
        eventCount: true,
        status: true,
      },
    });
    if (recording === null) {
      throw new RecordingWorkflowConversionRepositoryError(
        'RECORDING_NOT_FOUND',
      );
    }
    if (recording.status !== 'completed') {
      throw new RecordingWorkflowConversionRepositoryError(
        'RECORDING_NOT_COMPLETED',
      );
    }
    if (
      report.sourceClientSessionId !== recording.clientSessionId ||
      report.sourceEventCount !== recording.eventCount
    ) {
      throw new RecordingWorkflowConversionRepositoryError(
        'INVALID_CONVERSION_INPUT',
      );
    }

    const existing = await transaction.recordingWorkflowConversion.findUnique({
      where: {
        recordingSessionId_clientConversionId: {
          recordingSessionId,
          clientConversionId,
        },
      },
      select: conversionSelect,
    });
    if (existing !== null) {
      const conversion = toConversionRecord(existing);
      if (!hasMatchingRequest(conversion, workflowDefinition)) {
        throw new RecordingWorkflowConversionRepositoryError(
          'CONVERSION_CONFLICT',
        );
      }
      return {
        conversion,
        idempotent: true,
      };
    }

    await transaction.workflow.create({
      data: {
        id: workflowDefinition.workflowId,
        workspaceId: recording.workspaceId,
        name: workflowDefinition.name,
        description: workflowDefinition.description ?? null,
      },
    });
    const workflowVersion = await transaction.workflowVersion.create({
      data: {
        workflowId: workflowDefinition.workflowId,
        version: 1,
        status: 'draft',
        schemaVersion: workflowDefinition.schemaVersion,
        definition: workflowDefinition as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    const conversion = await transaction.recordingWorkflowConversion.create({
      data: {
        recordingSessionId,
        clientConversionId,
        workflowId: workflowDefinition.workflowId,
        workflowVersionId: workflowVersion.id,
        createdById: actorUserId,
        conversionReport: report as Prisma.InputJsonValue,
      },
      select: conversionSelect,
    });

    return {
      conversion: toConversionRecord(conversion),
      idempotent: false,
    };
  }

  private async findAccessibleExisting(
    actorUserId: string,
    recordingSessionId: string,
    clientConversionId: string,
  ): Promise<RecordingWorkflowConversionRecord | null> {
    const row = await this.prisma.recordingWorkflowConversion.findFirst({
      where: {
        recordingSessionId,
        clientConversionId,
        recordingSession: {
          workspace: {
            organization: {
              members: {
                some: {
                  userId: actorUserId,
                  role: { in: [...CONVERSION_ROLES] },
                },
              },
            },
          },
        },
      },
      select: conversionSelect,
    });

    return row === null ? null : toConversionRecord(row);
  }

  private async runSerializable<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> {
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: unknown) {
        if (!isPrismaErrorCode(error, 'P2034')) {
          throw error;
        }
        if (attempt === MAX_SERIALIZABLE_ATTEMPTS) {
          throw new RecordingWorkflowConversionRepositoryError(
            'SERIALIZATION_FAILURE',
          );
        }
      }
    }

    throw new RecordingWorkflowConversionRepositoryError(
      'SERIALIZATION_FAILURE',
    );
  }
}
