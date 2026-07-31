import {
  SafeExecutionException,
  type SafeExecutionError,
} from '@tasktwin/workflow-engine';
import { errors } from 'playwright';

export { SafeExecutionException, safeError } from '@tasktwin/workflow-engine';

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

export function cleanupError(error: unknown): SafeExecutionError {
  return error instanceof SafeExecutionException
    ? error.safe
    : {
        code: 'RESOURCE_CLEANUP_FAILED',
        message: 'Execution resources could not be closed cleanly.',
      };
}
