import type { PrivacyDecision } from './contracts.js';

const EMAIL_PATTERN =
  /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i;
const PHONE_PATTERN = /(?:^|[^\w])(?:\+?\d[\s().-]?){9,15}(?:$|[^\w])/;
const LONG_NUMBER_PATTERN = /(?:^|[^\d])\d{12,19}(?:$|[^\d])/;
const OTP_PATTERN = /\b\d{6}\b/;
const TOKEN_PATTERN =
  /\b(?:bearer\s+|api[_ -]?key\s*[:=]\s*|token\s*[:=]\s*)[a-z0-9._~+/=-]{8,}\b/i;
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

export type SensitiveLiteralKind =
  'personal' | 'authentication' | 'financial-or-identity';

const SENSITIVE_LITERAL_KIND_ORDER = [
  'personal',
  'authentication',
  'financial-or-identity',
] as const satisfies readonly SensitiveLiteralKind[];

export function detectSensitiveLiteralKinds(
  value: string,
): readonly SensitiveLiteralKind[] {
  const normalized = value.trim().replace(UUID_PATTERN, '');
  const detected = new Set<SensitiveLiteralKind>();

  if (EMAIL_PATTERN.test(normalized) || PHONE_PATTERN.test(normalized)) {
    detected.add('personal');
  }
  if (OTP_PATTERN.test(normalized) || TOKEN_PATTERN.test(normalized)) {
    detected.add('authentication');
  }
  if (LONG_NUMBER_PATTERN.test(normalized)) {
    detected.add('financial-or-identity');
  }

  return SENSITIVE_LITERAL_KIND_ORDER.filter((kind) => detected.has(kind));
}

export function containsSensitiveLiteral(value: string): boolean {
  return detectSensitiveLiteralKinds(value).length > 0;
}

export function sanitizePersistedText(
  value: string | null,
  maximumLength = 160,
): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0 || containsSensitiveLiteral(normalized)) {
    return null;
  }
  return normalized.slice(0, maximumLength);
}

export type SanitizedCapturedValue =
  | {
      policy: 'allow';
      value: string;
      truncated: boolean;
    }
  | {
      policy: 'mask';
      value: null;
      truncated: false;
    }
  | {
      policy: 'block';
    };

export function sanitizeCapturedValue(
  value: string,
  decision: PrivacyDecision,
  maximumLength = 2_048,
): SanitizedCapturedValue {
  if (!Number.isInteger(maximumLength) || maximumLength < 1) {
    throw new Error(
      'Maximum captured value length must be a positive integer.',
    );
  }
  if (decision.policy === 'block') {
    return { policy: 'block' };
  }
  if (decision.policy === 'mask') {
    return { policy: 'mask', value: null, truncated: false };
  }
  return {
    policy: 'allow',
    value: value.slice(0, maximumLength),
    truncated: value.length > maximumLength,
  };
}
