import { z } from 'zod';

import {
  MAX_DEVICE_PIXEL_RATIO,
  MAX_PRIVACY_METADATA_LENGTH,
  MAX_PRIVACY_REASONS,
  MAX_PRIVACY_RULES,
  MAX_REDACTION_COORDINATE,
  MAX_REDACTION_REGIONS,
} from './constants.js';

const BoundedMetadataSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PRIVACY_METADATA_LENGTH);

export const SensitivitySchema = z.enum([
  'public',
  'general',
  'personal',
  'authentication',
  'financial',
  'identity',
  'health',
  'unknown-sensitive',
]);

export const PrivacyPolicySchema = z.enum(['allow', 'mask', 'block']);
export const PrivacyConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const PrivacyClassificationInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  tagName: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[a-z][a-z0-9-]*$/),
  inputType: BoundedMetadataSchema.nullable(),
  autocomplete: BoundedMetadataSchema.nullable(),
  name: BoundedMetadataSchema.nullable(),
  id: BoundedMetadataSchema.nullable(),
  labelText: BoundedMetadataSchema.nullable(),
  accessibleName: BoundedMetadataSchema.nullable(),
  placeholder: BoundedMetadataSchema.nullable(),
  role: BoundedMetadataSchema.nullable(),
});

export const PrivacyRuleIdSchema = z.enum([
  'AUTH_PASSWORD_TYPE',
  'AUTH_AUTOCOMPLETE',
  'AUTH_METADATA',
  'FINANCIAL_AUTOCOMPLETE',
  'FINANCIAL_METADATA',
  'IDENTITY_METADATA',
  'HEALTH_METADATA',
  'PERSONAL_INPUT_TYPE',
  'PERSONAL_AUTOCOMPLETE',
  'PERSONAL_METADATA',
  'UNKNOWN_SENSITIVE_METADATA',
  'SENSITIVE_METADATA_LITERAL',
  'PUBLIC_SEMANTIC_ELEMENT',
  'GENERAL_NO_SENSITIVE_SIGNAL',
]);

export const PrivacyReasonSchema = z.enum([
  'Element metadata describes a public interaction.',
  'No supported sensitive metadata rule matched.',
  'Deterministic personal metadata rules matched.',
  'Deterministic authentication metadata rules matched.',
  'Deterministic financial metadata rules matched.',
  'Deterministic identity metadata rules matched.',
  'Deterministic health metadata rules matched.',
  'Deterministic unknown-sensitive metadata rules matched.',
]);

const PrivacyDecisionObjectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sensitivity: SensitivitySchema,
  policy: PrivacyPolicySchema,
  confidence: PrivacyConfidenceSchema,
  matchedRules: z.array(PrivacyRuleIdSchema).min(1).max(MAX_PRIVACY_RULES),
  reasons: z.array(PrivacyReasonSchema).min(1).max(MAX_PRIVACY_REASONS),
});

const SENSITIVITY_RULE_PREFIXES = {
  public: ['PUBLIC_'],
  general: ['GENERAL_'],
  personal: ['PERSONAL_'],
  authentication: ['AUTH_'],
  financial: ['FINANCIAL_'],
  identity: ['IDENTITY_'],
  health: ['HEALTH_'],
  'unknown-sensitive': ['UNKNOWN_', 'SENSITIVE_'],
} as const;

const SENSITIVITY_REASONS = {
  public: 'Element metadata describes a public interaction.',
  general: 'No supported sensitive metadata rule matched.',
  personal: 'Deterministic personal metadata rules matched.',
  authentication: 'Deterministic authentication metadata rules matched.',
  financial: 'Deterministic financial metadata rules matched.',
  identity: 'Deterministic identity metadata rules matched.',
  health: 'Deterministic health metadata rules matched.',
  'unknown-sensitive':
    'Deterministic unknown-sensitive metadata rules matched.',
} as const;

export const PrivacyDecisionSchema = PrivacyDecisionObjectSchema.superRefine(
  (decision, context) => {
    const requiredPolicy =
      decision.sensitivity === 'authentication' ||
      decision.sensitivity === 'financial' ||
      decision.sensitivity === 'identity' ||
      decision.sensitivity === 'health'
        ? 'block'
        : decision.sensitivity === 'unknown-sensitive'
          ? 'mask'
          : decision.sensitivity === 'public' ||
              decision.sensitivity === 'general'
            ? 'allow'
            : null;

    if (requiredPolicy !== null && decision.policy !== requiredPolicy) {
      context.addIssue({
        code: 'custom',
        path: ['policy'],
        message: `The ${decision.sensitivity} sensitivity requires the ${requiredPolicy} policy.`,
      });
    }
    if (
      decision.sensitivity === 'personal' &&
      decision.policy !== 'allow' &&
      decision.policy !== 'mask'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['policy'],
        message: 'Personal data may only use the allow or mask policy.',
      });
    }

    const prefixes = SENSITIVITY_RULE_PREFIXES[decision.sensitivity];
    decision.matchedRules.forEach((rule, index) => {
      if (!prefixes.some((prefix) => rule.startsWith(prefix))) {
        context.addIssue({
          code: 'custom',
          path: ['matchedRules', index],
          message: 'Matched rule must belong to the selected sensitivity.',
        });
      }
    });

    if (
      decision.reasons.length !== 1 ||
      decision.reasons[0] !== SENSITIVITY_REASONS[decision.sensitivity]
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reasons'],
        message: 'Decision reason must match the selected sensitivity.',
      });
    }
  },
);

export const PrivacySettingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  personalDataPolicy: z.enum(['allow', 'mask']),
  redactAllTextInputs: z.boolean(),
  showRedactionPreview: z.boolean(),
});

export const DEFAULT_PRIVACY_SETTINGS = Object.freeze({
  schemaVersion: 1,
  personalDataPolicy: 'mask',
  redactAllTextInputs: false,
  showRedactionPreview: false,
} as const satisfies PrivacySettings);

const FiniteCoordinateSchema = z
  .number()
  .finite()
  .min(-MAX_REDACTION_COORDINATE)
  .max(MAX_REDACTION_COORDINATE);

const PositiveViewportDimensionSchema = z
  .number()
  .finite()
  .positive()
  .max(MAX_REDACTION_COORDINATE);

export const RedactionViewportSchema = z.strictObject({
  width: PositiveViewportDimensionSchema,
  height: PositiveViewportDimensionSchema,
  devicePixelRatio: z.number().finite().positive().max(MAX_DEVICE_PIXEL_RATIO),
});

export const RedactionRegionCandidateSchema = z.strictObject({
  id: z.string().trim().min(1).max(80),
  x: FiniteCoordinateSchema,
  y: FiniteCoordinateSchema,
  width: FiniteCoordinateSchema,
  height: FiniteCoordinateSchema,
  sensitivity: SensitivitySchema,
  reasons: z.array(PrivacyRuleIdSchema).min(1).max(MAX_PRIVACY_REASONS),
});

export const RedactionRegionSchema = z.strictObject({
  id: z.string().trim().min(1).max(80),
  x: z.number().finite().nonnegative().max(MAX_REDACTION_COORDINATE),
  y: z.number().finite().nonnegative().max(MAX_REDACTION_COORDINATE),
  width: z.number().finite().positive().max(MAX_REDACTION_COORDINATE),
  height: z.number().finite().positive().max(MAX_REDACTION_COORDINATE),
  mode: z.literal('solid'),
  sensitivity: SensitivitySchema,
  reasons: z.array(PrivacyRuleIdSchema).min(1).max(MAX_PRIVACY_REASONS),
});

export const RedactionPlanSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    viewport: RedactionViewportSchema,
    generatedAt: z.string().datetime({ offset: true }),
    regions: z.array(RedactionRegionSchema).max(MAX_REDACTION_REGIONS),
  })
  .superRefine((plan, context) => {
    plan.regions.forEach((region, index) => {
      if (
        region.x + region.width > plan.viewport.width ||
        region.y + region.height > plan.viewport.height
      ) {
        context.addIssue({
          code: 'custom',
          path: ['regions', index],
          message: 'Redaction region must remain inside the viewport.',
        });
      }
    });
  });

export type Sensitivity = z.infer<typeof SensitivitySchema>;
export type PrivacyPolicy = z.infer<typeof PrivacyPolicySchema>;
export type PrivacyConfidence = z.infer<typeof PrivacyConfidenceSchema>;
export type PrivacyRuleId = z.infer<typeof PrivacyRuleIdSchema>;
export type PrivacyClassificationInput = z.infer<
  typeof PrivacyClassificationInputSchema
>;
export type PrivacyDecision = z.infer<typeof PrivacyDecisionSchema>;
export type PrivacySettings = z.infer<typeof PrivacySettingsSchema>;
export type RedactionViewport = z.infer<typeof RedactionViewportSchema>;
export type RedactionRegionCandidate = z.infer<
  typeof RedactionRegionCandidateSchema
>;
export type RedactionRegion = z.infer<typeof RedactionRegionSchema>;
export type RedactionPlan = z.infer<typeof RedactionPlanSchema>;
