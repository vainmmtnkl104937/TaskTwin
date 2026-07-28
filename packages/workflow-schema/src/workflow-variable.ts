import { z } from 'zod';

import { IdentifierSchema, NonEmptyStringSchema } from './primitives.js';

export const WorkflowVariableValueTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
]);

export const WorkflowVariableSchema = z.strictObject({
  name: IdentifierSchema,
  valueType: WorkflowVariableValueTypeSchema,
  required: z.boolean(),
  description: NonEmptyStringSchema.optional(),
});

export type WorkflowVariableValueType = z.infer<
  typeof WorkflowVariableValueTypeSchema
>;
export type WorkflowVariable = z.infer<typeof WorkflowVariableSchema>;
