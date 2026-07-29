import { IdentifierSchema } from '@tasktwin/workflow-schema';

import { MAX_SECRET_REFERENCE_NAME_LENGTH } from './constants.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const JWT_PATTERN =
  /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
const CREDENTIAL_ASSIGNMENT_PATTERN =
  /^(?:password|passwd|pwd|token|secret|api[_-]?key|authorization)\s*[:=]\s*\S+$/i;
const URL_CREDENTIAL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i;
const KNOWN_TOKEN_PREFIX_PATTERN =
  /^(?:gh[pousr]_|sk-|xox[baprs]-|AKIA)[A-Za-z0-9_-]{12,}$/;
const LONG_TOKEN_PATTERN = /^[A-Za-z0-9+/_=-]{40,}$/;

export function isSafeSecretAlias(value: string): boolean {
  return (
    value.length <= MAX_SECRET_REFERENCE_NAME_LENGTH &&
    IdentifierSchema.safeParse(value).success &&
    !EMAIL_PATTERN.test(value) &&
    !JWT_PATTERN.test(value) &&
    !CREDENTIAL_ASSIGNMENT_PATTERN.test(value) &&
    !URL_CREDENTIAL_PATTERN.test(value) &&
    !KNOWN_TOKEN_PREFIX_PATTERN.test(value) &&
    !LONG_TOKEN_PATTERN.test(value)
  );
}
