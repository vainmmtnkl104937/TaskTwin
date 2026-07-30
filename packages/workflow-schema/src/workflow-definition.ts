import { z } from 'zod';

import { NonEmptyStringSchema } from './primitives.js';
import { WorkflowStepSchema } from './workflow-step.js';
import { WorkflowVariableSchema } from './workflow-variable.js';

export const WorkflowLifecycleStatusSchema = z.enum([
  'draft',
  'testing',
  'published',
  'archived',
]);

const WorkflowDefinitionV1ObjectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  workflowId: NonEmptyStringSchema,
  version: z.number().int().positive(),
  name: NonEmptyStringSchema,
  description: NonEmptyStringSchema.optional(),
  status: WorkflowLifecycleStatusSchema,
  variables: z.array(WorkflowVariableSchema),
  steps: z.array(WorkflowStepSchema).min(1),
});

export const WorkflowDefinitionV1Schema =
  WorkflowDefinitionV1ObjectSchema.superRefine((workflow, context) => {
    const stepIds = new Set<string>();

    workflow.steps.forEach((step, index) => {
      if (stepIds.has(step.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate step ID: ${step.id}`,
          path: ['steps', index, 'id'],
        });
      }

      stepIds.add(step.id);
    });

    const variableNames = new Set<string>();

    workflow.variables.forEach((variable, index) => {
      if (variableNames.has(variable.name)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate variable name: ${variable.name}`,
          path: ['variables', index, 'name'],
        });
      }

      variableNames.add(variable.name);
    });
  });

export const WorkflowDefinitionSchema = WorkflowDefinitionV1Schema;

export type WorkflowLifecycleStatus = z.infer<
  typeof WorkflowLifecycleStatusSchema
>;
export type WorkflowDefinitionV1 = z.infer<typeof WorkflowDefinitionV1Schema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
