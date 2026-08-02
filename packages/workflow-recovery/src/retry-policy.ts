import {
  MAX_AUTOMATIC_RETRIES,
  MAX_MANUAL_RETRIES,
  MAX_TOTAL_ATTEMPTS,
} from './constants.js';
import {
  RetryPolicyDecisionSchema,
  RetryPolicyInputSchema,
  type RetryPolicyDecision,
  type RetryPolicyInput,
} from './contracts.js';
import { classifyFailure } from './failure-classifier.js';

const AUTO_RETRY = new Map<string, ReadonlySet<string>>([
  ['verify', new Set(['VERIFICATION_NOT_MATCHED', 'LOCATOR_NOT_FOUND'])],
  ['extract', new Set(['EXTRACTION_VALUE_UNAVAILABLE', 'LOCATOR_NOT_FOUND'])],
]);
const MANUAL_STEP_TYPES = new Set([
  'verify',
  'extract',
  'click',
  'fill',
  'select',
  'setChecked',
]);
const MANUAL_BLOCKED_CATEGORIES = new Set([
  'validation',
  'policy',
  'cancellation',
  'approval',
  'output',
  'infrastructure',
  'unknown',
]);

export function decideRetry(input: RetryPolicyInput): RetryPolicyDecision {
  const value = RetryPolicyInputSchema.parse(input);
  const category = classifyFailure(value.errorCode);
  if (value.approvalGated) {
    return RetryPolicyDecisionSchema.parse({
      category,
      disposition: 'new_run_required',
      retryAllowed: false,
      recoveryErrorCode: 'APPROVAL_GATED_RETRY_REQUIRES_NEW_RUN',
    });
  }
  if (
    value.effectCertainty === 'unknown' ||
    value.effectCertainty === 'side_effect_possible' ||
    value.effectCertainty === 'completed'
  ) {
    return { category, disposition: 'none', retryAllowed: false };
  }
  if (value.totalAttemptCount >= MAX_TOTAL_ATTEMPTS) {
    return {
      category,
      disposition: 'none',
      retryAllowed: false,
      recoveryErrorCode: 'RECOVERY_ATTEMPT_LIMIT_REACHED',
    };
  }
  const autoErrors = AUTO_RETRY.get(value.stepType);
  if (
    value.effectCertainty === 'read_only' &&
    autoErrors?.has(value.errorCode) === true &&
    value.automaticRetryCount < MAX_AUTOMATIC_RETRIES
  ) {
    return { category, disposition: 'automatic_retry', retryAllowed: true };
  }
  const manualEffectAllowed =
    value.effectCertainty === 'read_only' ||
    value.effectCertainty === 'not_started';
  if (
    value.recoveryMode === 'automatic_safe_and_manual' &&
    manualEffectAllowed &&
    MANUAL_STEP_TYPES.has(value.stepType) &&
    !MANUAL_BLOCKED_CATEGORIES.has(category) &&
    value.manualRetryCount < MAX_MANUAL_RETRIES
  ) {
    return { category, disposition: 'manual_repair', retryAllowed: true };
  }
  return { category, disposition: 'none', retryAllowed: false };
}
