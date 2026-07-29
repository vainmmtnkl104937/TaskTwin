import {
  DEFAULT_PRIVACY_SETTINGS,
  PrivacyClassificationInputSchema,
  PrivacyDecisionSchema,
  PrivacySettingsSchema,
  type PrivacyClassificationInput,
  type PrivacyConfidence,
  type PrivacyDecision,
  type PrivacySettings,
  type Sensitivity,
} from './contracts.js';
import { resolvePrivacyPolicy } from './policy.js';
import {
  PRIVACY_RULES,
  SENSITIVITY_PRIORITY,
  type PrivacyRule,
} from './rules.js';
import { containsSensitiveLiteral } from './sanitization.js';

type MetadataField = Exclude<
  keyof PrivacyClassificationInput,
  'schemaVersion' | 'tagName'
>;

const ALL_METADATA_FIELDS: readonly MetadataField[] = [
  'inputType',
  'autocomplete',
  'name',
  'id',
  'labelText',
  'accessibleName',
  'placeholder',
  'role',
];

function normalize(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/giu, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchesRule(
  input: PrivacyClassificationInput,
  rule: PrivacyRule,
): boolean {
  const fields = rule.fields ?? ALL_METADATA_FIELDS;
  return fields.some((field) => {
    const value = input[field];
    if (value === null) {
      return false;
    }
    const normalized = normalize(value);
    return rule.terms.some((term) => normalized.includes(normalize(term)));
  });
}

function confidenceRank(confidence: PrivacyConfidence): number {
  return confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
}

function classifyBase(input: PrivacyClassificationInput): {
  sensitivity: Sensitivity;
  confidence: PrivacyConfidence;
  rules: PrivacyRule[];
} {
  const matches = PRIVACY_RULES.filter((rule) => matchesRule(input, rule));
  for (const sensitivity of SENSITIVITY_PRIORITY) {
    const selected = matches.filter((rule) => rule.sensitivity === sensitivity);
    if (selected.length > 0) {
      return {
        sensitivity,
        confidence: selected.reduce<PrivacyConfidence>(
          (current, rule) =>
            confidenceRank(rule.confidence) > confidenceRank(current)
              ? rule.confidence
              : current,
          'low',
        ),
        rules: selected,
      };
    }
  }

  if (
    ALL_METADATA_FIELDS.some((field) => {
      const value = input[field];
      return value !== null && containsSensitiveLiteral(value);
    })
  ) {
    return {
      sensitivity: 'unknown-sensitive',
      confidence: 'medium',
      rules: [
        {
          id: 'SENSITIVE_METADATA_LITERAL',
          sensitivity: 'unknown-sensitive',
          confidence: 'medium',
          terms: [],
        },
      ],
    };
  }

  const isPublic =
    input.tagName === 'button' ||
    input.tagName === 'a' ||
    input.role === 'button' ||
    input.role === 'link';
  return {
    sensitivity: isPublic ? 'public' : 'general',
    confidence: isPublic ? 'high' : 'medium',
    rules: [],
  };
}

export function classifyPrivacy(
  rawInput: PrivacyClassificationInput,
  rawSettings: PrivacySettings = DEFAULT_PRIVACY_SETTINGS,
): PrivacyDecision {
  const input = PrivacyClassificationInputSchema.parse(rawInput);
  const settings = PrivacySettingsSchema.parse(rawSettings);
  const classification = classifyBase(input);
  const fallbackRule =
    classification.sensitivity === 'public'
      ? 'PUBLIC_SEMANTIC_ELEMENT'
      : 'GENERAL_NO_SENSITIVE_SIGNAL';

  return PrivacyDecisionSchema.parse({
    schemaVersion: 1,
    sensitivity: classification.sensitivity,
    policy: resolvePrivacyPolicy(classification.sensitivity, settings),
    confidence: classification.confidence,
    matchedRules:
      classification.rules.length === 0
        ? [fallbackRule]
        : classification.rules.map((rule) => rule.id),
    reasons: [
      classification.sensitivity === 'public'
        ? 'Element metadata describes a public interaction.'
        : classification.sensitivity === 'general'
          ? 'No supported sensitive metadata rule matched.'
          : `Deterministic ${classification.sensitivity} metadata rules matched.`,
    ],
  });
}
