export const AUDIT_TRAIL_ERROR_CODES = [
  'AUDIT_CHAIN_HEAD_MISSING',
  'AUDIT_SOURCE_CONFLICT',
  'AUDIT_EVENT_NOT_FOUND',
  'AUDIT_INVALID_CURSOR',
] as const;

export type AuditTrailErrorCode =
  (typeof AUDIT_TRAIL_ERROR_CODES)[number];

export class AuditTrailRepositoryError extends Error {
  constructor(
    readonly code: AuditTrailErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'AuditTrailRepositoryError';
  }
}