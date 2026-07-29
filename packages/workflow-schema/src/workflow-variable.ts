import { z } from 'zod';

import { IdentifierSchema, NonEmptyStringSchema } from './primitives.js';

export const MAX_WORKFLOW_VARIABLE_LABEL_LENGTH = 120;
export const MAX_WORKFLOW_VARIABLE_DESCRIPTION_LENGTH = 500;

export const WorkflowVariableValueTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'date',
  'file',
]);

export const WorkflowVariableSchema = z.strictObject({
  name: IdentifierSchema,
  label: NonEmptyStringSchema.max(
    MAX_WORKFLOW_VARIABLE_LABEL_LENGTH,
  ).optional(),
  valueType: WorkflowVariableValueTypeSchema,
  required: z.boolean(),
  description: NonEmptyStringSchema.max(
    MAX_WORKFLOW_VARIABLE_DESCRIPTION_LENGTH,
  ).optional(),
});

export type WorkflowVariableValueType = z.infer<
  typeof WorkflowVariableValueTypeSchema
>;
export type WorkflowVariable = z.infer<typeof WorkflowVariableSchema>;
