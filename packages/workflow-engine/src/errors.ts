import {
  SafeExecutionErrorSchema,
  type ExecutionErrorCode,
  type SafeExecutionError,
} from './contracts.js';

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
} as const satisfies Record<ExecutionErrorCode, string>;

export function safeError(code: ExecutionErrorCode): SafeExecutionError {
  return SafeExecutionErrorSchema.parse({
    code,
    message: SAFE_MESSAGES[code],
  });
}

export class SafeExecutionException extends Error {
  readonly safe: SafeExecutionError;

  constructor(code: ExecutionErrorCode) {
    const details = safeError(code);
    super(details.message);
    this.name = 'SafeExecutionException';
    this.safe = details;
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
