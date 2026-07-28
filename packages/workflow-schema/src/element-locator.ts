import { z } from 'zod';

import { NonEmptyStringSchema } from './primitives.js';

export const TestIdLocatorSchema = z.strictObject({
  kind: z.literal('testId'),
  value: NonEmptyStringSchema,
});

export const RoleLocatorSchema = z.strictObject({
  kind: z.literal('role'),
  role: NonEmptyStringSchema,
  name: NonEmptyStringSchema.optional(),
  exact: z.boolean().optional(),
});

export const LabelLocatorSchema = z.strictObject({
  kind: z.literal('label'),
  value: NonEmptyStringSchema,
  exact: z.boolean().optional(),
});

export const TextLocatorSchema = z.strictObject({
  kind: z.literal('text'),
  value: NonEmptyStringSchema,
  exact: z.boolean().optional(),
});

export const CssLocatorSchema = z.strictObject({
  kind: z.literal('css'),
  selector: NonEmptyStringSchema,
});

export const ElementLocatorSchema = z.discriminatedUnion('kind', [
  TestIdLocatorSchema,
  RoleLocatorSchema,
  LabelLocatorSchema,
  TextLocatorSchema,
  CssLocatorSchema,
]);

export type TestIdLocator = z.infer<typeof TestIdLocatorSchema>;
export type RoleLocator = z.infer<typeof RoleLocatorSchema>;
export type LabelLocator = z.infer<typeof LabelLocatorSchema>;
export type TextLocator = z.infer<typeof TextLocatorSchema>;
export type CssLocator = z.infer<typeof CssLocatorSchema>;
export type ElementLocator = z.infer<typeof ElementLocatorSchema>;
