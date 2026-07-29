const SENSITIVE_QUERY_PARAMETER =
  /(?:^|[_-])(auth|authorization|token|access|refresh|password|passcode|pin|otp|code|secret|session|cookie|card|cvv|cvc|ssn|identity|health)(?:$|[_-])/i;

export type NavigateUrlIssueCode =
  | 'NAVIGATE_URL_INVALID'
  | 'NAVIGATE_URL_PROTOCOL_UNSUPPORTED'
  | 'NAVIGATE_URL_CREDENTIALS_FORBIDDEN'
  | 'NAVIGATE_URL_SENSITIVE_QUERY';

export interface NavigateUrlValidationResult {
  valid: boolean;
  code?: NavigateUrlIssueCode;
}

export function validateNavigateUrl(
  urlValue: string,
): NavigateUrlValidationResult {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return { valid: false, code: 'NAVIGATE_URL_INVALID' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { valid: false, code: 'NAVIGATE_URL_PROTOCOL_UNSUPPORTED' };
  }

  if (url.username !== '' || url.password !== '') {
    return { valid: false, code: 'NAVIGATE_URL_CREDENTIALS_FORBIDDEN' };
  }

  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_PARAMETER.test(key)) {
      return { valid: false, code: 'NAVIGATE_URL_SENSITIVE_QUERY' };
    }
  }

  return { valid: true };
}

export function summarizeNavigateUrl(urlValue: string): string {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return 'Invalid URL';
  }

  const safeKeys = [...new Set(url.searchParams.keys())]
    .filter((key) => !SENSITIVE_QUERY_PARAMETER.test(key))
    .sort((left, right) => left.localeCompare(right));
  const querySummary =
    safeKeys.length === 0
      ? ''
      : `?${safeKeys.map((key) => `${encodeURIComponent(key)}=…`).join('&')}`;

  return `${url.origin}${url.pathname}${querySummary}`;
}
