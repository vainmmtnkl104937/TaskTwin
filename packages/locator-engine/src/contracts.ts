import { ElementLocatorSchema } from '@tasktwin/workflow-schema';
import { z } from 'zod';

import {
  MAX_CSS_SELECTOR_LENGTH,
  MAX_LOCATOR_CANDIDATES,
  MAX_LOCATOR_FALLBACKS,
  MAX_LOCATOR_VALUE_LENGTH,
  MAX_TEST_ID_LENGTH,
  MAX_VISIBLE_TEXT_LENGTH,
} from './constants.js';
import { canonicalizeLocator } from './canonical-locator.js';

export const LocatorSourceSchema = z.enum([
  'testId',
  'role',
  'label',
  'stableId',
  'placeholder',
  'stableName',
  'text',
  'css',
]);

export const LocatorConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const LocatorReasonCodeSchema = z.enum([
  'UNIQUE_MATCH',
  'STRONG_TEST_ID',
  'ACCESSIBLE_ROLE',
  'ASSOCIATED_LABEL',
  'STABLE_ID',
  'PLACEHOLDER',
  'STABLE_NAME',
  'UNIQUE_TEXT',
  'CSS_FALLBACK',
  'SHORT_VALUE',
  'DYNAMIC_UUID',
  'DYNAMIC_TIMESTAMP',
  'DYNAMIC_HASH',
  'DYNAMIC_NUMERIC_SUFFIX',
  'FRAMEWORK_GENERATED',
  'RANDOM_LOOKING',
  'POSITIONAL_CSS',
  'DEEP_CSS',
  'GENERATED_CLASS',
]);

export const LOCATOR_REASON_MESSAGES = {
  UNIQUE_MATCH: 'Matches exactly one element.',
  STRONG_TEST_ID: 'Uses an allowlisted test identifier.',
  ACCESSIBLE_ROLE: 'Uses a reliable role and accessible name.',
  ASSOCIATED_LABEL: 'Uses an associated form-control label.',
  STABLE_ID: 'Uses an identifier that appears stable.',
  PLACEHOLDER: 'Uses a bounded placeholder.',
  STABLE_NAME: 'Uses a name attribute that appears stable.',
  UNIQUE_TEXT: 'Uses short unique visible text.',
  CSS_FALLBACK: 'Uses a bounded semantic CSS fallback.',
  SHORT_VALUE: 'Uses a short normalized locator value.',
  DYNAMIC_UUID: 'The identifier resembles a UUID.',
  DYNAMIC_TIMESTAMP: 'The identifier resembles a timestamp.',
  DYNAMIC_HASH: 'The identifier resembles a generated hash.',
  DYNAMIC_NUMERIC_SUFFIX: 'The identifier has a generated numeric suffix.',
  FRAMEWORK_GENERATED: 'The identifier resembles a framework-generated value.',
  RANDOM_LOOKING: 'The identifier resembles a random session value.',
  POSITIONAL_CSS: 'The CSS selector uses positional matching.',
  DEEP_CSS: 'The CSS selector uses a deeper ancestry chain.',
  GENERATED_CLASS: 'The CSS selector contains a generated-looking class.',
} as const satisfies Record<LocatorReasonCode, string>;

export const LocatorReasonSchema = z
  .strictObject({
    code: LocatorReasonCodeSchema,
    message: z.string().trim().min(1).max(160),
  })
  .superRefine((reason, context) => {
    if (reason.message !== LOCATOR_REASON_MESSAGES[reason.code]) {
      context.addIssue({
        code: 'custom',
        path: ['message'],
        message: 'Reason message must match its deterministic reason code.',
      });
    }
  });

function getLocatorString(
  locator: z.infer<typeof ElementLocatorSchema>,
): string {
  switch (locator.kind) {
    case 'testId':
    case 'label':
    case 'text':
    case 'placeholder':
      return locator.value;
    case 'role':
      return locator.name ?? locator.role;
    case 'css':
      return locator.selector;
  }
}

function validateLocatorBounds(
  locator: z.infer<typeof ElementLocatorSchema>,
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  const value = getLocatorString(locator);
  const maximum =
    locator.kind === 'css'
      ? MAX_CSS_SELECTOR_LENGTH
      : locator.kind === 'testId'
        ? MAX_TEST_ID_LENGTH
        : locator.kind === 'text'
          ? MAX_VISIBLE_TEXT_LENGTH
          : MAX_LOCATOR_VALUE_LENGTH;

  if (value.length > maximum) {
    context.addIssue({
      code: 'too_big',
      maximum,
      origin: 'string',
      inclusive: true,
      path,
      message: `Locator string must contain at most ${maximum} characters.`,
    });
  }

  if (locator.kind === 'css' && /^\s*(?:\/|xpath\s*=)/i.test(value)) {
    context.addIssue({
      code: 'custom',
      path,
      message: 'XPath is not a supported locator strategy.',
    });
  }
}

export const LocatorObservationSchema = z
  .strictObject({
    locator: ElementLocatorSchema,
    source: LocatorSourceSchema,
    matchCount: z.number().int().nonnegative(),
    stabilityValue: z.string().trim().min(1).max(MAX_LOCATOR_VALUE_LENGTH),
  })
  .superRefine((observation, context) => {
    validateLocatorBounds(observation.locator, context, ['locator']);
    validateSourceLocator(
      observation.source,
      observation.locator.kind,
      context,
      ['source'],
    );
  });

const SOURCE_LOCATOR_KINDS = {
  testId: 'testId',
  role: 'role',
  label: 'label',
  stableId: 'css',
  placeholder: 'placeholder',
  stableName: 'css',
  text: 'text',
  css: 'css',
} as const satisfies Record<
  z.infer<typeof LocatorSourceSchema>,
  z.infer<typeof ElementLocatorSchema>['kind']
>;

function validateSourceLocator(
  source: z.infer<typeof LocatorSourceSchema>,
  kind: z.infer<typeof ElementLocatorSchema>['kind'],
  context: z.RefinementCtx,
  path: PropertyKey[],
): void {
  if (SOURCE_LOCATOR_KINDS[source] !== kind) {
    context.addIssue({
      code: 'custom',
      path,
      message: 'Locator source must match the locator strategy.',
    });
  }
}

const SOURCE_REASON_CODES = {
  testId: 'STRONG_TEST_ID',
  role: 'ACCESSIBLE_ROLE',
  label: 'ASSOCIATED_LABEL',
  stableId: 'STABLE_ID',
  placeholder: 'PLACEHOLDER',
  stableName: 'STABLE_NAME',
  text: 'UNIQUE_TEXT',
  css: 'CSS_FALLBACK',
} as const satisfies Record<
  z.infer<typeof LocatorSourceSchema>,
  z.infer<typeof LocatorReasonCodeSchema>
>;

export const LocatorCandidateSchema = z
  .strictObject({
    locator: ElementLocatorSchema,
    score: z.number().int().min(0).max(100),
    matchCount: z.literal(1),
    unique: z.literal(true),
    source: LocatorSourceSchema,
    reasons: z.array(LocatorReasonSchema).min(1).max(12),
  })
  .superRefine((candidate, context) => {
    validateLocatorBounds(candidate.locator, context, ['locator']);
    validateSourceLocator(candidate.source, candidate.locator.kind, context, [
      'source',
    ]);
    for (const requiredReason of [
      SOURCE_REASON_CODES[candidate.source],
      'UNIQUE_MATCH',
    ] as const) {
      if (!candidate.reasons.some((reason) => reason.code === requiredReason)) {
        context.addIssue({
          code: 'custom',
          path: ['reasons'],
          message: `Locator reasons must include ${requiredReason}.`,
        });
      }
    }
  });

export const LocatorBundleSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    primary: LocatorCandidateSchema,
    fallbacks: z.array(LocatorCandidateSchema).max(MAX_LOCATOR_FALLBACKS),
    confidence: LocatorConfidenceSchema,
    generatedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((bundle, context) => {
    const candidates = [bundle.primary, ...bundle.fallbacks];
    const canonical = new Set<string>();

    candidates.forEach((candidate, index) => {
      const key = canonicalizeLocator(candidate.locator);
      if (canonical.has(key)) {
        context.addIssue({
          code: 'custom',
          path: index === 0 ? ['primary', 'locator'] : ['fallbacks', index - 1],
          message: 'Locator candidates must be deduplicated.',
        });
      }
      canonical.add(key);

      if (index > 0 && candidate.score > candidates[index - 1]!.score) {
        context.addIssue({
          code: 'custom',
          path: ['fallbacks', index - 1, 'score'],
          message: 'Fallback scores must be ordered from highest to lowest.',
        });
      }
    });
  });

export const LocatorObservationListSchema = z
  .array(LocatorObservationSchema)
  .max(MAX_LOCATOR_CANDIDATES);

export type LocatorSource = z.infer<typeof LocatorSourceSchema>;
export type LocatorConfidence = z.infer<typeof LocatorConfidenceSchema>;
export type LocatorReasonCode = z.infer<typeof LocatorReasonCodeSchema>;
export type LocatorReason = z.infer<typeof LocatorReasonSchema>;
export type LocatorObservation = z.infer<typeof LocatorObservationSchema>;
export type LocatorCandidate = z.infer<typeof LocatorCandidateSchema>;
export type LocatorBundle = z.infer<typeof LocatorBundleSchema>;
