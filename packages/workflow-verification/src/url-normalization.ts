import { MAX_VERIFICATION_URL_LENGTH } from './constants.js';

export type UrlVerificationMatchMode = 'origin' | 'origin_and_path';

export type SafeUrlNormalizationResult =
  | { ok: true; origin: string; pathname: string }
  | { ok: false; code: 'invalid' | 'unsafe' };

export function normalizeVerificationUrl(
  input: string,
): SafeUrlNormalizationResult {
  if (input.length === 0 || input.length > MAX_VERIFICATION_URL_LENGTH) {
    return { ok: false, code: 'invalid' };
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, code: 'invalid' };
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return { ok: false, code: 'unsafe' };
  }
  return { ok: true, origin: url.origin, pathname: url.pathname };
}

export function compareVerificationUrls(
  actual: string,
  expected: string,
  matchMode: UrlVerificationMatchMode,
): boolean {
  const left = normalizeVerificationUrl(actual);
  const right = normalizeVerificationUrl(expected);
  if (!left.ok || !right.ok || left.origin !== right.origin) {
    return false;
  }
  return matchMode === 'origin' || left.pathname === right.pathname;
}
