import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';
import type { WorkflowLifecycleStatus } from '@tasktwin/workflow-schema';

import type { Prisma, PrismaClient } from './generated/prisma/client.js';

export interface PersistedWorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  revision: number;
  status: WorkflowLifecycleStatus;
  schemaVersion: number;
  definition: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

export class WorkflowVersionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    workspaceId: string,
    definitionInput: unknown,
  ): Promise<PersistedWorkflowVersion> {
    const definition = WorkflowDefinitionSchema.parse(definitionInput);

    return this.prisma.$transaction(async (transaction) => {
      const existingWorkflow = await transaction.workflow.findUnique({
        where: { id: definition.workflowId },
        select: { workspaceId: true },
      });

      if (
        existingWorkflow !== null &&
        existingWorkflow.workspaceId !== workspaceId
      ) {
        throw new Error('Workflow belongs to a different workspace');
      }

      await transaction.workflow.upsert({
        where: { id: definition.workflowId },
        create: {
          id: definition.workflowId,
          workspaceId,
          name: definition.name,
          description: definition.description ?? null,
        },
        update: {
          name: definition.name,
          description: definition.description ?? null,
        },
      });

      return transaction.workflowVersion.create({
        data: {
          workflowId: definition.workflowId,
          version: definition.version,
          status: definition.status,
          schemaVersion: definition.schemaVersion,
          definition: definition as Prisma.InputJsonValue,
        },
      });
    });
  }
}
