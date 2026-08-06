export const AUDIT_ERROR_CODES = [
  'AUDIT_EVENT_INVALID',
  'AUDIT_HASH_INVALID',
  'AUDIT_PAYLOAD_TOO_LARGE',
  'AUDIT_SOURCE_CONFLICT',
  'AUDIT_STORAGE_FAILURE',
] as const;

export type AuditErrorCode = (typeof AUDIT_ERROR_CODES)[number];

export class AuditTrailError extends Error {
  constructor(
    readonly code: AuditErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'AuditTrailError';
  }
}
