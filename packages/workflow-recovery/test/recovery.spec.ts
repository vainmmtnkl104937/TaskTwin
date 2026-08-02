import { describe, expect, it } from 'vitest';

import {
  SafeStepAttemptListSchema,
  SafeStepAttemptSchema,
  canTransitionRepairRequest,
  classifyFailure,
  decideRetry,
} from '../src/index.js';

const base = {
  stepType: 'verify' as const,
  errorCode: 'VERIFICATION_NOT_MATCHED',
  effectCertainty: 'read_only' as const,
  recoveryMode: 'automatic_safe_and_manual' as const,
  automaticRetryCount: 0,
  manualRetryCount: 0,
  totalAttemptCount: 1,
  approvalGated: false,
};

describe('workflow recovery policy', () => {
  it('classifies failures deterministically', () => {
    expect(classifyFailure('VERIFICATION_NOT_MATCHED')).toBe('transient_read');
    expect(classifyFailure('LOCATOR_NOT_FOUND')).toBe('locator_resolution');
    expect(classifyFailure('unrecognized')).toBe('unknown');
  });

  it('automatically retries only allowlisted read-only failures', () => {
    expect(decideRetry(base).disposition).toBe('automatic_retry');
    expect(decideRetry({ ...base, stepType: 'click' }).disposition).not.toBe(
      'automatic_retry',
    );
  });

  it('allows a pre-action manual repair but rejects uncertain effects', () => {
    expect(
      decideRetry({
        ...base,
        stepType: 'fill',
        errorCode: 'LOCATOR_NOT_FOUND',
        effectCertainty: 'not_started',
      }).disposition,
    ).toBe('manual_repair');
    expect(
      decideRetry({ ...base, effectCertainty: 'side_effect_possible' })
        .retryAllowed,
    ).toBe(false);
    expect(
      decideRetry({ ...base, effectCertainty: 'unknown' }).retryAllowed,
    ).toBe(false);
  });

  it('enforces attempt limits and approval gating', () => {
    expect(decideRetry({ ...base, totalAttemptCount: 3 }).retryAllowed).toBe(
      false,
    );
    expect(decideRetry({ ...base, approvalGated: true })).toMatchObject({
      disposition: 'new_run_required',
      retryAllowed: false,
    });
  });

  it('validates attempt continuity and manual authorization', () => {
    const initial = {
      attemptNumber: 1,
      trigger: 'initial',
      status: 'failed',
      startedAt: '2026-08-02T00:00:00.000Z',
      finishedAt: '2026-08-02T00:00:01.000Z',
      durationMs: 1000,
      errorCode: 'LOCATOR_NOT_FOUND',
      effectCertainty: 'not_started',
    } as const;
    expect(SafeStepAttemptSchema.safeParse(initial).success).toBe(true);
    expect(
      SafeStepAttemptListSchema.safeParse([
        initial,
        { ...initial, attemptNumber: 3, trigger: 'automatic_retry' },
      ]).success,
    ).toBe(false);
    expect(
      SafeStepAttemptSchema.safeParse({
        ...initial,
        attemptNumber: 2,
        trigger: 'manual_retry',
      }).success,
    ).toBe(false);
  });

  it('permits exactly one terminal repair decision', () => {
    expect(canTransitionRepairRequest('PENDING', 'RETRY_APPROVED')).toBe(true);
    expect(canTransitionRepairRequest('RETRY_APPROVED', 'ABORTED')).toBe(false);
  });

  it('strict safe summaries reject raw fields', () => {
    expect(
      SafeStepAttemptSchema.safeParse({
        attemptNumber: 1,
        trigger: 'initial',
        status: 'failed',
        startedAt: '2026-08-02T00:00:00.000Z',
        finishedAt: '2026-08-02T00:00:01.000Z',
        durationMs: 1000,
        errorCode: 'ACTION_FAILED',
        effectCertainty: 'unknown',
        rawError: 'sensitive value',
      }).success,
    ).toBe(false);
  });
});
