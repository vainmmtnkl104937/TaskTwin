export const OPERATIONAL_TELEMETRY_ERROR_CODES = [
  'TELEMETRY_INVALID',
  'TELEMETRY_WINDOW_UNSUPPORTED',
  'TELEMETRY_TIMESTAMP_INVALID',
  'TELEMETRY_RATE_INVALID',
  'TELEMETRY_SNAPSHOT_INVALID',
  'TELEMETRY_STORAGE_UNAVAILABLE',
] as const;

export type OperationalTelemetryErrorCode =
  (typeof OPERATIONAL_TELEMETRY_ERROR_CODES)[number];

export class OperationalTelemetryError extends Error {
  constructor(
    readonly code: OperationalTelemetryErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'OperationalTelemetryError';
  }
}
