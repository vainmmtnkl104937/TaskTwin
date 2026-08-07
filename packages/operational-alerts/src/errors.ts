export const OPERATIONAL_ALERT_ERROR_CODES = [
  'OPERATIONAL_ALERT_INVALID',
  'OPERATIONAL_ALERT_SOURCE_CONFLICT',
  'OPERATIONAL_ALERT_RECIPIENTS_EMPTY',
  'OPERATIONAL_ALERT_INVALID_TRANSITION',
  'OPERATIONAL_ALERT_STORAGE_FAILURE',
  'OPERATIONAL_ALERT_WORKSPACE_NOT_FOUND',
  'OPERATIONAL_ALERT_RESOLUTION_CONFLICT',
  'OPERATIONAL_ALERT_RECIPIENTS_EXCEEDED',
] as const;

export type OperationalAlertErrorCode =
  (typeof OPERATIONAL_ALERT_ERROR_CODES)[number];

export class OperationalAlertError extends Error {
  constructor(
    readonly code: OperationalAlertErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'OperationalAlertError';
  }
}
