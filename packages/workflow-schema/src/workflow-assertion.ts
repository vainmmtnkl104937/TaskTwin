import { z } from 'zod';

import { ElementLocatorSchema } from './element-locator.js';
import { ValueSourceSchema } from './value-source.js';

export const AssertionOperatorSchema = z.enum(['equals', 'contains']);
export const TextMatchModeSchema = z.enum(['exact', 'contains']);
export const UrlMatchModeSchema = z.enum(['origin', 'origin_and_path']);

function requireOneMatchMode(
  value: { operator?: unknown; matchMode?: unknown },
  context: z.RefinementCtx,
): void {
  if ((value.operator === undefined) === (value.matchMode === undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['matchMode'],
      message: 'Exactly one match mode representation is required.',
    });
  }
}

export const VisibleAssertionSchema = z.strictObject({
  kind: z.literal('visible'),
  locator: ElementLocatorSchema,
});

export const HiddenAssertionSchema = z.strictObject({
  kind: z.literal('hidden'),
  locator: ElementLocatorSchema,
});

export const TextAssertionSchema = z
  .strictObject({
    kind: z.literal('text'),
    locator: ElementLocatorSchema,
    matchMode: TextMatchModeSchema.optional(),
    operator: AssertionOperatorSchema.optional(),
    expected: ValueSourceSchema,
  })
  .superRefine(requireOneMatchMode);

export const ValueAssertionSchema = z.strictObject({
  kind: z.literal('value'),
  locator: ElementLocatorSchema,
  operator: AssertionOperatorSchema.optional(),
  expected: ValueSourceSchema,
});

export const UrlAssertionSchema = z
  .strictObject({
    kind: z.literal('url'),
    matchMode: UrlMatchModeSchema.optional(),
    operator: AssertionOperatorSchema.optional(),
    expected: ValueSourceSchema,
  })
  .superRefine(requireOneMatchMode);

export const CheckedAssertionSchema = z.strictObject({
  kind: z.literal('checked'),
  locator: ElementLocatorSchema,
  expected: z.boolean(),
});

export const WorkflowAssertionSchema = z.discriminatedUnion('kind', [
  VisibleAssertionSchema,
  HiddenAssertionSchema,
  TextAssertionSchema,
  ValueAssertionSchema,
  UrlAssertionSchema,
  CheckedAssertionSchema,
]);

export type AssertionOperator = z.infer<typeof AssertionOperatorSchema>;
export type TextMatchMode = z.infer<typeof TextMatchModeSchema>;
export type UrlMatchMode = z.infer<typeof UrlMatchModeSchema>;
export type VisibleAssertion = z.infer<typeof VisibleAssertionSchema>;
export type HiddenAssertion = z.infer<typeof HiddenAssertionSchema>;
export type TextAssertion = z.infer<typeof TextAssertionSchema>;
export type ValueAssertion = z.infer<typeof ValueAssertionSchema>;
export type UrlAssertion = z.infer<typeof UrlAssertionSchema>;
export type CheckedAssertion = z.infer<typeof CheckedAssertionSchema>;
export type WorkflowAssertion = z.infer<typeof WorkflowAssertionSchema>;
