import {
  LocatorRepairEligibilityInputSchema,
  type LocatorRepairEligibilityDecision,
  type LocatorRepairEligibilityInput,
} from './contracts.js';

export function assessLocatorRepairEligibility(
  input: LocatorRepairEligibilityInput,
): LocatorRepairEligibilityDecision {
  const parsed = LocatorRepairEligibilityInputSchema.parse(input);
  if (
    parsed.errorCode !== 'LOCATOR_NOT_FOUND' &&
    parsed.errorCode !== 'LOCATOR_NOT_UNIQUE'
  ) {
    return { eligible: false, reason: 'UNSUPPORTED_FAILURE' };
  }
  if (parsed.approvalGated) {
    return { eligible: false, reason: 'APPROVAL_GATED_STEP' };
  }
  const { step } = parsed;
  if (
    step.type === 'navigate' ||
    step.type === 'wait' ||
    step.type === 'approval'
  ) {
    return { eligible: false, reason: 'UNSUPPORTED_STEP' };
  }
  const locator =
    step.type === 'verify'
      ? 'locator' in step.assertion
        ? step.assertion.locator
        : undefined
      : 'locator' in step
        ? step.locator
        : undefined;
  if (locator === undefined) {
    return { eligible: false, reason: 'ELEMENT_LOCATOR_REQUIRED' };
  }
  const readOnly = step.type === 'verify' || step.type === 'extract';
  const effectAllowed = readOnly
    ? parsed.effectCertainty === 'read_only' ||
      parsed.effectCertainty === 'not_started'
    : parsed.effectCertainty === 'not_started';
  return effectAllowed
    ? {
        eligible: true,
        failureCode: parsed.errorCode,
        locator,
      }
    : { eligible: false, reason: 'EFFECT_NOT_SAFE' };
}
