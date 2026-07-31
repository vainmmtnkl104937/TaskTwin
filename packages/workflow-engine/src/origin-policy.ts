import { SafeExecutionException } from './errors.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function normalizeAllowedOrigins(
  values: readonly string[],
): readonly string[] {
  const normalized = new Set<string>();
  for (const value of values) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new SafeExecutionException('INVALID_EXECUTION_REQUEST');
    }
    if (
      !ALLOWED_PROTOCOLS.has(url.protocol) ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new SafeExecutionException('INVALID_EXECUTION_REQUEST');
    }
    if (normalized.has(url.origin)) {
      throw new SafeExecutionException('INVALID_EXECUTION_REQUEST');
    }
    normalized.add(url.origin);
  }
  return [...normalized];
}

export function validateNavigationUrl(
  value: string,
  allowedOrigins: readonly string[],
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafeExecutionException('INVALID_NAVIGATION_URL');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SafeExecutionException('UNSAFE_URL_SCHEME');
  }
  if (url.username !== '' || url.password !== '') {
    throw new SafeExecutionException('INVALID_NAVIGATION_URL');
  }
  if (!allowedOrigins.includes(url.origin)) {
    throw new SafeExecutionException('ORIGIN_NOT_ALLOWED');
  }
  return url;
}
