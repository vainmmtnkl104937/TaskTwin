export const WORKFLOW_SCHEDULING_SCHEMA_VERSION = 1 as const;

/** Default maximum time between the scheduled instant and the start deadline (5 minutes). */
export const DEFAULT_MAX_START_DELAY_SECONDS = 300;

/** Upper bound for maxStartDelaySeconds (1 hour). */
export const MAX_MAX_START_DELAY_SECONDS = 3600;

/** Minimum allowed maxStartDelaySeconds (30 seconds). */
export const MIN_MAX_START_DELAY_SECONDS = 30;

/**
 * Overlap policy: what to do when a schedule fires while a previous occurrence
 * is still active.
 */
export const OVERLAP_POLICY_VALUES = ['skip'] as const;

/**
 * Misfire policy: what to do when a scheduled occurrence is missed because the
 * scheduler was not running at the exact instant.
 */
export const MISFIRE_POLICY_VALUES = ['skip'] as const;

/** IANA timezone names that are always valid and commonly used. */
export const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'America/Mexico_City',
  'Africa/Johannesburg',
  'Africa/Lagos',
] as const;
