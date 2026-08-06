import { serializeCanonicalJson } from './canonical-json.js';
import { hashAuditContent, type AuditHasher } from './hasher.js';

const SOURCE_NAMESPACE_PATTERN = /^[a-z][a-z0-9_.-]{0,47}$/;

export function createAuditSourceId(
  namespace: string,
  parts: readonly (string | number)[],
  hasher: AuditHasher,
): string {
  if (!SOURCE_NAMESPACE_PATTERN.test(namespace) || parts.length === 0 || parts.length > 8) {
    throw new TypeError('Audit source namespace or parts are invalid');
  }
  for (const part of parts) {
    if (
      (typeof part === 'string' && (part.length === 0 || part.length > 256)) ||
      (typeof part === 'number' && (!Number.isSafeInteger(part) || part < 0))
    ) {
      throw new TypeError('Audit source part is invalid');
    }
  }
  return `${namespace}:${hashAuditContent(hasher, serializeCanonicalJson(parts))}`;
}
