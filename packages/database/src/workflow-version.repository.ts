import { WorkflowDefinitionSchema } from '@tasktwin/workflow-schema';

import type { Prisma, PrismaClient } from './generated/prisma/client.js';

export interface PersistedWorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  schemaVersion: number;
  definition: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

export class WorkflowVersionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(definitionInput: unknown): Promise<PersistedWorkflowVersion> {
    const definition = WorkflowDefinitionSchema.parse(definitionInput);

    return this.prisma.$transaction(async (transaction) => {
      await transaction.workflow.upsert({
        where: { id: definition.workflowId },
        create: {
          id: definition.workflowId,
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
