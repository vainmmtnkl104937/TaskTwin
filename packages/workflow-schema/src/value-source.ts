import { z } from 'zod';

import { IdentifierSchema, SecretReferenceNameSchema } from './primitives.js';

export const LiteralValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
]);

export const LiteralValueSourceSchema = z.strictObject({
  kind: z.literal('literal'),
  value: LiteralValueSchema,
});

export const VariableValueSourceSchema = z.strictObject({
  kind: z.literal('variable'),
  variableName: IdentifierSchema,
});

export const SecretValueSourceSchema = z.strictObject({
  kind: z.literal('secret'),
  secretName: SecretReferenceNameSchema,
});

export const ValueSourceSchema = z.discriminatedUnion('kind', [
  LiteralValueSourceSchema,
  VariableValueSourceSchema,
  SecretValueSourceSchema,
]);

export type LiteralValue = z.infer<typeof LiteralValueSchema>;
export type LiteralValueSource = z.infer<typeof LiteralValueSourceSchema>;
export type VariableValueSource = z.infer<typeof VariableValueSourceSchema>;
export type SecretValueSource = z.infer<typeof SecretValueSourceSchema>;
export type ValueSource = z.infer<typeof ValueSourceSchema>;
