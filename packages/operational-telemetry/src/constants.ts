export const OPERATIONAL_TELEMETRY_SCHEMA_VERSION = 1 as const;

export const OPERATIONAL_COMPONENT_TYPES = [
  'control_plane_api',
  'scheduler',
  'notification_worker',
] as const;

export const COMPONENT_HEALTH_STATES = [
  'healthy',
  'degraded',
  'unavailable',
  'unknown',
] as const;

export const HEALTHY_HEARTBEAT_MAX_AGE_SECONDS = 90;
export const DEGRADED_HEARTBEAT_MAX_AGE_SECONDS = 180;
export const COMPONENT_HEARTBEAT_INTERVAL_SECONDS = 30;

export const METRIC_WINDOWS = ['1h', '24h', '7d', '30d'] as const;

export const METRIC_WINDOW_DEFINITIONS = {
  '1h': { durationSeconds: 3_600, bucketSeconds: 300, bucketCount: 12 },
  '24h': { durationSeconds: 86_400, bucketSeconds: 3_600, bucketCount: 24 },
  '7d': { durationSeconds: 604_800, bucketSeconds: 86_400, bucketCount: 7 },
  '30d': { durationSeconds: 2_592_000, bucketSeconds: 86_400, bucketCount: 30 },
} as const;
