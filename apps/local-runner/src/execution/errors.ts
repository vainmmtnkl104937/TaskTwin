import {
  SafeExecutionException,
  type SafeExecutionError,
} from '@tasktwin/workflow-engine';
import { errors } from 'playwright';
import type { ExecutionEffectCertainty } from '@tasktwin/workflow-recovery';

export { SafeExecutionException, safeError } from '@tasktwin/workflow-engine';

export function mapActionError(
  error: unknown,
  kind: 'navigation' | 'action',
  signal?: AbortSignal,
  effectCertainty: ExecutionEffectCertainty = 'unknown',
): SafeExecutionException {
  if (error instanceof SafeExecutionException) {
    return new SafeExecutionException(
      error.safe.code,
      error.verification,
      error.effectCertainty ?? effectCertainty,
    );
  }
  if (signal?.aborted === true) {
    return new SafeExecutionException(
      'EXECUTION_CANCELLED',
      undefined,
      effectCertainty,
    );
  }
  if (error instanceof errors.TimeoutError) {
    return new SafeExecutionException(
      kind === 'navigation' ? 'NAVIGATION_TIMEOUT' : 'ACTION_TIMEOUT',
      undefined,
      effectCertainty,
    );
  }
  return new SafeExecutionException(
    'ACTION_FAILED',
    undefined,
    effectCertainty,
  );
}

export function cleanupError(error: unknown): SafeExecutionError {
  return error instanceof SafeExecutionException
    ? error.safe
    : {
        code: 'RESOURCE_CLEANUP_FAILED',
        message: 'Execution resources could not be closed cleanly.',
      };
}
