import { OperationalTelemetryError } from './errors.js';

export function calculateRate(
  numerator: number,
  denominator: number,
): number | null {
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator < 0 ||
    denominator < 0 ||
    numerator > denominator
  ) {
    throw new OperationalTelemetryError('TELEMETRY_RATE_INVALID');
  }
  if (denominator === 0) {
    return null;
  }
  return numerator / denominator;
}
