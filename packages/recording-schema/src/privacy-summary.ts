import {
  PrivacyPolicySchema,
  SensitivitySchema,
  type PrivacyPolicy,
  type Sensitivity,
} from '@tasktwin/privacy-engine';
import { z } from 'zod';

import { MAX_RECORDING_EVENTS } from './constants.js';
import type { RecordingEvent } from './events.js';

const CountSchema = z.number().int().min(0).max(MAX_RECORDING_EVENTS);

export const RecordingPrivacyPolicyCountsSchema = z.strictObject({
  allow: CountSchema,
  mask: CountSchema,
  block: CountSchema,
});

export const RecordingSensitivityCountsSchema = z.strictObject({
  public: CountSchema,
  general: CountSchema,
  personal: CountSchema,
  authentication: CountSchema,
  financial: CountSchema,
  identity: CountSchema,
  health: CountSchema,
  unknownSensitive: CountSchema,
});

export const RecordingPrivacySummarySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    totalEvents: CountSchema,
    policyCounts: RecordingPrivacyPolicyCountsSchema,
    sensitivityCounts: RecordingSensitivityCountsSchema,
  })
  .superRefine((summary, context) => {
    const policyTotal = Object.values(summary.policyCounts).reduce(
      (total, count) => total + count,
      0,
    );
    if (policyTotal !== summary.totalEvents) {
      context.addIssue({
        code: 'custom',
        path: ['policyCounts'],
        message: 'Privacy policy counts must equal total events.',
      });
    }

    const sensitivityTotal = Object.values(summary.sensitivityCounts).reduce(
      (total, count) => total + count,
      0,
    );
    if (sensitivityTotal !== summary.totalEvents) {
      context.addIssue({
        code: 'custom',
        path: ['sensitivityCounts'],
        message: 'Sensitivity counts must equal total events.',
      });
    }
  });

const SENSITIVITY_COUNT_KEYS = {
  public: 'public',
  general: 'general',
  personal: 'personal',
  authentication: 'authentication',
  financial: 'financial',
  identity: 'identity',
  health: 'health',
  'unknown-sensitive': 'unknownSensitive',
} as const satisfies Record<
  Sensitivity,
  keyof z.infer<typeof RecordingSensitivityCountsSchema>
>;

export function createRecordingPrivacySummary(
  events: readonly RecordingEvent[],
): RecordingPrivacySummary {
  const policyCounts: Record<PrivacyPolicy, number> = {
    allow: 0,
    mask: 0,
    block: 0,
  };
  const sensitivityCounts: z.infer<typeof RecordingSensitivityCountsSchema> = {
    public: 0,
    general: 0,
    personal: 0,
    authentication: 0,
    financial: 0,
    identity: 0,
    health: 0,
    unknownSensitive: 0,
  };

  for (const event of events) {
    const policy = PrivacyPolicySchema.parse(event.privacyDecision.policy);
    const sensitivity = SensitivitySchema.parse(
      event.privacyDecision.sensitivity,
    );
    policyCounts[policy] += 1;
    sensitivityCounts[SENSITIVITY_COUNT_KEYS[sensitivity]] += 1;
  }

  return RecordingPrivacySummarySchema.parse({
    schemaVersion: 1,
    totalEvents: events.length,
    policyCounts,
    sensitivityCounts,
  });
}

export const summarizeRecordingPrivacy = createRecordingPrivacySummary;

export type RecordingPrivacySummary = z.infer<
  typeof RecordingPrivacySummarySchema
>;
