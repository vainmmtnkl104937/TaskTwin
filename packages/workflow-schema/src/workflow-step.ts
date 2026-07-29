import { z } from 'zod';

import { ElementLocatorSchema } from './element-locator.js';
import {
  IdentifierSchema,
  MAX_WAIT_DURATION_MS,
  NonEmptyStringSchema,
} from './primitives.js';
import { ValueSourceSchema } from './value-source.js';
import { WorkflowAssertionSchema } from './workflow-assertion.js';

const baseStepShape = {
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
};

export const NavigateStepSchema = z.strictObject({
  ...baseStepShape,
  type: z.literal('navigate'),
  url: ValueSourceSchema,
});

export const ClickStepSchema = z.strictObject({
  ...baseStepShape,
  type: z.literal('click'),
  locator: ElementLocatorSchema,
});

export const FillStepSchema = z.strictObject({
  ...baseStepShape,
  type: z.literal('fill'),
  locator: ElementLocatorSchema,
  value: ValueSourceSchema,
});

export const SelectStepSchema = z.strictObject({
  ...baseStepShape,
  type: z.literal('select'),
  locator: ElementLocatorSchema,
  value: ValueSourceSchema,
});

export const SetCheckedStepSchema = z.strictObject({
  ...baseStepShape,
  type: z.literal('setChecked'),
  locator: ElementLocatorSchema,
  checked: z.boolean(),
});

export const WaitStepSchema = z.strictObject({
  ...baseStepShape,
  type: z.literal('wait'),
  durationMs: z.number().int().min(1).max(MAX_WAIT_DURATION_MS),
});

export const TextExtractSourceSchema = z.strictObject({
  kind: z.literal('text'),
});

export const ValueExtractSourceSchema = z.strictObject({
  kind: z.literal('value'),
});

export const AttributeExtractSourceSchema = z.strictObject({
  kind: z.literal('attribute'),
  name: NonEmptyStringSchema,
});

export const ExtractSourceSchema = z.discriminatedUnion('kind', [
  TextExtractSourceSchema,
  ValueExtractSourceSchema,
  AttributeExtractSourceSchema,
]);

export const ExtractStepSchema = z.strictObject({
  ...baseStepShape,
  type: z.literal('extract'),
  locator: ElementLocatorSchema,
  source: ExtractSourceSchema,
  outputName: IdentifierSchema,
});

export const VerifyStepSchema = z.strictObject({
  ...baseStepShape,
  type: z.literal('verify'),
  assertion: WorkflowAssertionSchema,
});

export const ApprovalStepSchema = z.strictObject({
  ...baseStepShape,
  type: z.literal('approval'),
  message: NonEmptyStringSchema,
});

export const WorkflowStepSchema = z.discriminatedUnion('type', [
  NavigateStepSchema,
  ClickStepSchema,
  FillStepSchema,
  SelectStepSchema,
  SetCheckedStepSchema,
  WaitStepSchema,
  ExtractStepSchema,
  VerifyStepSchema,
  ApprovalStepSchema,
]);

export type NavigateStep = z.infer<typeof NavigateStepSchema>;
export type ClickStep = z.infer<typeof ClickStepSchema>;
export type FillStep = z.infer<typeof FillStepSchema>;
export type SelectStep = z.infer<typeof SelectStepSchema>;
export type SetCheckedStep = z.infer<typeof SetCheckedStepSchema>;
export type WaitStep = z.infer<typeof WaitStepSchema>;
export type TextExtractSource = z.infer<typeof TextExtractSourceSchema>;
export type ValueExtractSource = z.infer<typeof ValueExtractSourceSchema>;
export type AttributeExtractSource = z.infer<
  typeof AttributeExtractSourceSchema
>;
export type ExtractSource = z.infer<typeof ExtractSourceSchema>;
export type ExtractStep = z.infer<typeof ExtractStepSchema>;
export type VerifyStep = z.infer<typeof VerifyStepSchema>;
export type ApprovalStep = z.infer<typeof ApprovalStepSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
