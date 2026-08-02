import {
  SafeExecutionErrorSchema,
  type ExecutionErrorCode,
  type SafeExecutionError,
} from './contracts.js';
import type { SafeVerificationResult } from '@tasktwin/workflow-verification';
import type { ExecutionEffectCertainty } from '@tasktwin/workflow-recovery';

const SAFE_MESSAGES = {
  INVALID_EXECUTION_REQUEST: 'The workflow execution request is invalid.',
  INVALID_WORKFLOW: 'The workflow definition is invalid.',
  INVALID_RUNTIME_INPUTS: 'The workflow runtime inputs are invalid.',
  INVALID_EXECUTION_TIMEOUT: 'The workflow execution timeout is invalid.',
  UNSUPPORTED_STEP_TYPE: 'The workflow contains an unsupported step type.',
  SECRET_RESOLUTION_UNAVAILABLE: 'Secret resolution is unavailable.',
  INVALID_NAVIGATION_URL: 'The navigation destination is invalid.',
  UNSAFE_URL_SCHEME: 'The navigation protocol is not allowed.',
  ORIGIN_NOT_ALLOWED: 'The navigation origin is not allowed.',
  POST_NAVIGATION_ORIGIN_NOT_ALLOWED:
    'Navigation finished on an origin that is not allowed.',
  UNSUPPORTED_LOCATOR: 'The locator strategy is not supported.',
  UNSUPPORTED_ROLE: 'The locator role is not supported.',
  LOCATOR_NOT_FOUND: 'The locator did not match an element.',
  LOCATOR_NOT_UNIQUE: 'The locator matched more than one element.',
  BROWSER_LAUNCH_FAILED: 'Chromium could not be launched.',
  BROWSER_CONTEXT_FAILED: 'The isolated browser context could not be created.',
  ADAPTER_START_FAILED: 'The execution adapter could not be started.',
  NAVIGATION_TIMEOUT: 'Navigation exceeded its allowed step timeout.',
  ACTION_TIMEOUT: 'The browser action exceeded its allowed step timeout.',
  STEP_TIMEOUT: 'The workflow step exceeded its allowed timeout.',
  TOTAL_EXECUTION_TIMEOUT: 'The workflow exceeded its total execution timeout.',
  ACTION_FAILED: 'The browser action could not be completed.',
  EXECUTION_CANCELLED: 'The workflow execution was cancelled.',
  RESOURCE_CLEANUP_FAILED: 'Execution resources could not be closed cleanly.',
  INVALID_RUN_TRANSITION: 'The run state transition is invalid.',
  INVALID_STEP_TRANSITION: 'The step state transition is invalid.',
  VERIFICATION_RULE_INVALID: 'The verification rule is invalid.',
  VERIFICATION_EXPECTATION_INVALID: 'The verification expectation is invalid.',
  VERIFICATION_NOT_MATCHED: 'The verification outcome did not match.',
  VERIFICATION_TARGET_UNSUPPORTED: 'The verification target is not supported.',
  OUTPUT_NOT_AVAILABLE: 'The workflow output is not available.',
  OUTPUT_TYPE_MISMATCH: 'The workflow output type is incompatible.',
  DUPLICATE_OUTPUT_PRODUCTION:
    'The workflow output was produced more than once.',
  EXTRACTION_TARGET_UNSUPPORTED: 'The extraction target is not supported.',
  EXTRACTION_VALUE_UNAVAILABLE: 'The workflow output could not be extracted.',
  APPROVAL_COORDINATOR_UNAVAILABLE:
    'Human approval coordination is unavailable.',
  APPROVAL_BINDING_INVALID: 'The Approval step binding is invalid.',
  APPROVAL_REQUEST_FAILED: 'The approval request could not be completed.',
  APPROVAL_REJECTED: 'The workflow approval request was rejected.',
  APPROVAL_EXPIRED: 'The workflow approval request expired.',
  APPROVAL_INVALIDATED: 'The workflow approval request was invalidated.',
  RECOVERY_NOT_ALLOWED: 'The workflow step cannot be retried safely.',
  RECOVERY_ATTEMPT_LIMIT_REACHED: 'The workflow step retry limit was reached.',
  RECOVERY_COORDINATOR_UNAVAILABLE: 'Attended workflow repair is unavailable.',
  RECOVERY_REQUEST_FAILED:
    'The workflow repair request could not be completed.',
  RECOVERY_ABORTED: 'The workflow repair request was aborted.',
  RECOVERY_EXPIRED: 'The workflow repair request expired.',
  RECOVERY_INVALIDATED: 'The workflow repair request was invalidated.',
  APPROVAL_GATED_RETRY_REQUIRES_NEW_RUN:
    'An approval-gated action requires a new workflow run.',
} as const satisfies Record<ExecutionErrorCode, string>;

export function safeError(code: ExecutionErrorCode): SafeExecutionError {
  return SafeExecutionErrorSchema.parse({
    code,
    message: SAFE_MESSAGES[code],
  });
}

export class SafeExecutionException extends Error {
  readonly safe: SafeExecutionError;
  readonly verification: SafeVerificationResult | undefined;
  readonly effectCertainty: ExecutionEffectCertainty | undefined;

  constructor(
    code: ExecutionErrorCode,
    verification?: SafeVerificationResult,
    effectCertainty?: ExecutionEffectCertainty,
  ) {
    const details = safeError(code);
    super(details.message);
    this.name = 'SafeExecutionException';
    this.safe = details;
    this.verification = verification;
    this.effectCertainty = effectCertainty;
  }
}

export function toSafeError(
  error: unknown,
  fallback: ExecutionErrorCode,
): SafeExecutionError {
  return error instanceof SafeExecutionException
    ? error.safe
    : safeError(fallback);
}
