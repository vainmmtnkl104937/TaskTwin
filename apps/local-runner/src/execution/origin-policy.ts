import {
  SafeExecutionException,
  normalizeAllowedOrigins,
  validateNavigationUrl,
} from '@tasktwin/workflow-engine';

export { normalizeAllowedOrigins, validateNavigationUrl };

export function assertFinalOriginAllowed(
  value: string,
  allowedOrigins: readonly string[],
): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafeExecutionException('POST_NAVIGATION_ORIGIN_NOT_ALLOWED');
  }
  if (!allowedOrigins.includes(url.origin)) {
    throw new SafeExecutionException('POST_NAVIGATION_ORIGIN_NOT_ALLOWED');
  }
}
