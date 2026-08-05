const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function normalizeCanonicalOrigin(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('Origin must be a canonical HTTP(S) origin.');
  }
  return url.origin;
}

export function normalizeHttpsDomain(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\.$/, '');
  if (
    normalized.length === 0 ||
    normalized.length > 253 ||
    normalized.includes('*') ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      normalized,
    )
  ) {
    throw new Error('HTTPS subdomain pattern is invalid.');
  }
  return normalized;
}

export interface OriginFact {
  origin: string | null;
  safe: boolean;
  loopback: boolean;
  error:
    | 'POLICY_UNSAFE_URL_SCHEME'
    | 'POLICY_URL_CREDENTIALS_DENIED'
    | 'POLICY_ORIGIN_INVALID'
    | null;
}

export function inspectUrlOrigin(value: string): OriginFact {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      origin: null,
      safe: false,
      loopback: false,
      error: 'POLICY_ORIGIN_INVALID',
    };
  }
  if (url.username !== '' || url.password !== '') {
    return {
      origin: null,
      safe: false,
      loopback: false,
      error: 'POLICY_URL_CREDENTIALS_DENIED',
    };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      origin: null,
      safe: false,
      loopback: false,
      error: 'POLICY_UNSAFE_URL_SCHEME',
    };
  }
  return {
    origin: url.origin,
    safe: true,
    loopback: isLoopbackHostname(url.hostname),
    error: null,
  };
}
