import { errors } from 'playwright';

import {
  SafeExecutionErrorSchema,
  type ExecutionErrorCode,
  type SafeExecutionError,
} from './contracts.js';

const SAFE_MESSAGES = {
  INVALID_EXECUTION_REQUEST: 'The local execution request is invalid.',
  INVALID_WORKFLOW: 'The workflow definition is invalid.',
  INVALID_RUNTIME_INPUTS: 'The workflow runtime inputs are invalid.',
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
  NAVIGATION_TIMEOUT: 'Navigation exceeded its allowed timeout.',
  ACTION_TIMEOUT: 'The browser action exceeded its allowed timeout.',
  ACTION_FAILED: 'The browser action could not be completed.',
  EXECUTION_CANCELLED: 'The local execution was cancelled.',
  RESOURCE_CLEANUP_FAILED: 'Browser resources could not be closed cleanly.',
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

export function mapActionError(
  error: unknown,
  kind: 'navigation' | 'action',
  signal?: AbortSignal,
): SafeExecutionException {
  if (error instanceof SafeExecutionException) {
    return error;
  }
  if (signal?.aborted === true) {
    return new SafeExecutionException('EXECUTION_CANCELLED');
  }
  if (error instanceof errors.TimeoutError) {
    return new SafeExecutionException(
      kind === 'navigation' ? 'NAVIGATION_TIMEOUT' : 'ACTION_TIMEOUT',
    );
  }
  return new SafeExecutionException('ACTION_FAILED');
}
