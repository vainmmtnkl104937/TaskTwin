import { AuditTrailError } from './errors.js';

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export interface AuditHasher {
  sha256Hex(input: string): string;
}

export function requireSha256Hex(value: string): string {
  if (!SHA256_HEX_PATTERN.test(value)) {
    throw new AuditTrailError('AUDIT_HASH_INVALID');
  }
  return value;
}

export function hashAuditContent(
  hasher: AuditHasher,
  content: string,
): string {
  return requireSha256Hex(hasher.sha256Hex(content));
}

export const Sha256HexSchemaPattern = SHA256_HEX_PATTERN;
