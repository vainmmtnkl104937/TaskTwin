import { z } from 'zod';

import { ElementLocatorSchema } from './element-locator.js';
import { ValueSourceSchema } from './value-source.js';

export const AssertionOperatorSchema = z.enum(['equals', 'contains']);

export const VisibleAssertionSchema = z.strictObject({
  kind: z.literal('visible'),
  locator: ElementLocatorSchema,
});

export const HiddenAssertionSchema = z.strictObject({
  kind: z.literal('hidden'),
  locator: ElementLocatorSchema,
});

export const TextAssertionSchema = z.strictObject({
  kind: z.literal('text'),
  locator: ElementLocatorSchema,
  operator: AssertionOperatorSchema,
  expected: ValueSourceSchema,
});

export const ValueAssertionSchema = z.strictObject({
  kind: z.literal('value'),
  locator: ElementLocatorSchema,
  operator: AssertionOperatorSchema,
  expected: ValueSourceSchema,
});

export const UrlAssertionSchema = z.strictObject({
  kind: z.literal('url'),
  operator: AssertionOperatorSchema,
  expected: ValueSourceSchema,
});

export const WorkflowAssertionSchema = z.discriminatedUnion('kind', [
  VisibleAssertionSchema,
  HiddenAssertionSchema,
  TextAssertionSchema,
  ValueAssertionSchema,
  UrlAssertionSchema,
]);

export type AssertionOperator = z.infer<typeof AssertionOperatorSchema>;
export type VisibleAssertion = z.infer<typeof VisibleAssertionSchema>;
export type HiddenAssertion = z.infer<typeof HiddenAssertionSchema>;
export type TextAssertion = z.infer<typeof TextAssertionSchema>;
export type ValueAssertion = z.infer<typeof ValueAssertionSchema>;
export type UrlAssertion = z.infer<typeof UrlAssertionSchema>;
export type WorkflowAssertion = z.infer<typeof WorkflowAssertionSchema>;
