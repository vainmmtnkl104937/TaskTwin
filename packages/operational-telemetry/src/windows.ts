import { METRIC_WINDOW_DEFINITIONS } from './constants.js';
import {
  MetricWindowSchema,
  type MetricWindow,
  type MetricWindowSummary,
  type RunOutcomeBucket,
} from './contracts.js';
import { OperationalTelemetryError } from './errors.js';

export function parseMetricWindow(value: unknown): MetricWindow {
  const result = MetricWindowSchema.safeParse(value);
  if (!result.success) {
    throw new OperationalTelemetryError('TELEMETRY_WINDOW_UNSUPPORTED');
  }
  return result.data;
}

export function resolveMetricWindow(
  selected: MetricWindow,
  now: Date,
): MetricWindowSummary {
  if (!Number.isFinite(now.getTime())) {
    throw new OperationalTelemetryError('TELEMETRY_TIMESTAMP_INVALID');
  }
  const definition = METRIC_WINDOW_DEFINITIONS[selected];
  const endsAt = new Date(now.getTime());
  const startsAt = new Date(
    endsAt.getTime() - definition.durationSeconds * 1_000,
  );
  return {
    selected,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    bucketSeconds: definition.bucketSeconds,
    bucketCount: definition.bucketCount,
  };
}

export function createEmptyRunOutcomeBuckets(
  window: MetricWindowSummary,
): RunOutcomeBucket[] {
  const start = new Date(window.startsAt).getTime();
  const bucketMilliseconds = window.bucketSeconds * 1_000;
  return Array.from({ length: window.bucketCount }, (_, index) => ({
    startsAt: new Date(start + index * bucketMilliseconds).toISOString(),
    endsAt: new Date(start + (index + 1) * bucketMilliseconds).toISOString(),
    succeeded: 0,
    failed: 0,
    timedOut: 0,
    interrupted: 0,
    cancelled: 0,
  }));
}
