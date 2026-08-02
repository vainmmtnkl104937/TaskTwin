import type { FailureCategory } from './contracts.js';

const VALIDATION_ERRORS = new Set([
  'INVALID_EXECUTION_REQUEST',
  'INVALID_WORKFLOW',
  'INVALID_RUNTIME_INPUTS',
  'INVALID_EXECUTION_TIMEOUT',
  'UNSUPPORTED_STEP_TYPE',
  'UNSUPPORTED_LOCATOR',
  'UNSUPPORTED_ROLE',
  'VERIFICATION_RULE_INVALID',
  'VERIFICATION_EXPECTATION_INVALID',
  'VERIFICATION_TARGET_UNSUPPORTED',
  'EXTRACTION_TARGET_UNSUPPORTED',
]);
const POLICY_ERRORS = new Set([
  'SECRET_RESOLUTION_UNAVAILABLE',
  'INVALID_NAVIGATION_URL',
  'UNSAFE_URL_SCHEME',
  'ORIGIN_NOT_ALLOWED',
  'POST_NAVIGATION_ORIGIN_NOT_ALLOWED',
]);
const APPROVAL_ERRORS = new Set([
  'APPROVAL_COORDINATOR_UNAVAILABLE',
  'APPROVAL_BINDING_INVALID',
  'APPROVAL_REQUEST_FAILED',
  'APPROVAL_REJECTED',
  'APPROVAL_EXPIRED',
  'APPROVAL_INVALIDATED',
]);
const OUTPUT_ERRORS = new Set([
  'OUTPUT_NOT_AVAILABLE',
  'OUTPUT_TYPE_MISMATCH',
  'DUPLICATE_OUTPUT_PRODUCTION',
]);
const INFRASTRUCTURE_ERRORS = new Set([
  'BROWSER_LAUNCH_FAILED',
  'BROWSER_CONTEXT_FAILED',
  'ADAPTER_START_FAILED',
  'RESOURCE_CLEANUP_FAILED',
]);

export function classifyFailure(errorCode: string): FailureCategory {
  if (
    errorCode === 'VERIFICATION_NOT_MATCHED' ||
    errorCode === 'EXTRACTION_VALUE_UNAVAILABLE'
  ) {
    return 'transient_read';
  }
  if (errorCode === 'LOCATOR_NOT_FOUND' || errorCode === 'LOCATOR_NOT_UNIQUE') {
    return 'locator_resolution';
  }
  if (VALIDATION_ERRORS.has(errorCode)) return 'validation';
  if (POLICY_ERRORS.has(errorCode)) return 'policy';
  if (
    errorCode === 'EXECUTION_CANCELLED' ||
    errorCode === 'TOTAL_EXECUTION_TIMEOUT'
  ) {
    return 'cancellation';
  }
  if (APPROVAL_ERRORS.has(errorCode)) return 'approval';
  if (OUTPUT_ERRORS.has(errorCode)) return 'output';
  if (INFRASTRUCTURE_ERRORS.has(errorCode)) return 'infrastructure';
  if (errorCode === 'NAVIGATION_TIMEOUT') return 'navigation';
  if (
    errorCode === 'ACTION_TIMEOUT' ||
    errorCode === 'STEP_TIMEOUT' ||
    errorCode === 'ACTION_FAILED'
  ) {
    return 'action';
  }
  return 'unknown';
}
