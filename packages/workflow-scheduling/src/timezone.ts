import { DateTime, IANAZone } from 'luxon';

import type { IanaTimezone } from './definitions.js';

/**
 * Validate that a string is a known IANA timezone identifier.
 *
 * Uses Luxon's built-in validation.  Luxon checks against the underlying
 * Intl API / platform tz database at runtime, which is the same database
 * Node.js uses for Date arithmetic.
 */
export function isValidIanaTimezone(tz: string): tz is IanaTimezone {
  return IANAZone.isValidSpecifier(tz) && IANAZone.create(tz).isValid;
}

/**
 * Normalise a potentially user-supplied timezone string.
 * Returns null if the string is not a valid IANA identifier.
 */
export function validateIanaTimezone(tz: string): IanaTimezone | null {
  if (!isValidIanaTimezone(tz)) return null;
  return tz as IanaTimezone;
}

/**
 * DST outcome for a local (wall-clock) datetime in a given IANA timezone.
 */
export type DstOutcome =
  /** The local time does not exist (clocks SPRANG FORWARD). */
  | { readonly kind: 'nonexistent' }
  /** The local time occurs twice (clocks FELL BACK). Returns the earlier UTC instant. */
  | { readonly kind: 'repeated'; readonly instant: Date }
  /** The local time maps to exactly one UTC instant. */
  | { readonly kind: 'unambiguous'; readonly instant: Date };

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Convert a local (wall-clock) date + time in an IANA timezone to a UTC Date.
 *
 * DST semantics:
 * - Nonexistent local time (gap after a spring-forward) → 'nonexistent'
 * - Repeated local time (ambiguous hour after a fall-back) → 'repeated' with the
 *   earlier UTC instant
 *
 * These semantics ensure:
 * 1. We never execute the same local occurrence twice.
 * 2. When a time is skipped due to DST, we detect it and surface it.
 *
 * Detection strategy (round-trip via +1h UTC shift):
 *   - Nonexistent: Luxon shifts the produced wall-clock because the requested
 *     local time falls in the spring-forward gap.
 *   - Repeated:   the produced UTC instant, when advanced by 1 hour, still
 *     maps to the same wall-clock in the zone (the second occurrence of the
 *     repeated hour).
 *   - Unambiguous: advancing 1 hour leaves the wall-clock.
 *
 * For repeated times, Luxon picks the FIRST (earlier) occurrence by default,
 * which is exactly what ADR-027 requires for scheduled executions.
 */
export function localDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: IanaTimezone,
): DstOutcome {
  const zone = IANAZone.create(timezone);

  // Build the primary instant using the "keep local time" interpretation.
  // Luxon v2+ uses the second argument for options such as `zone`.
  const primary = DateTime.fromObject(
    { year, month, day, hour, minute, second: 0, millisecond: 0 },
    { zone },
  );

  // Nonexistent: the requested wall-clock was shifted by Luxon.
  const wallClockMatchesRequested =
    primary.year === year &&
    primary.month === month &&
    primary.day === day &&
    primary.hour === hour &&
    primary.minute === minute;

  if (!wallClockMatchesRequested) {
    return { kind: 'nonexistent' };
  }

  // Repeated: advancing 1 hour still lands on the same wall-clock in this zone.
  const shifted = DateTime.fromMillis(primary.toMillis() + ONE_HOUR_MS).setZone(
    zone,
  );

  const shiftLandsOnSameWallClock =
    shifted.year === year &&
    shifted.month === month &&
    shifted.day === day &&
    shifted.hour === hour &&
    shifted.minute === minute;

  if (shiftLandsOnSameWallClock) {
    return { kind: 'repeated', instant: primary.toJSDate() };
  }

  return { kind: 'unambiguous', instant: primary.toJSDate() };
}

/**
 * Check if a local date+time is valid (exists without DST gap) in a timezone.
 */
export function isLocalDateTimeValid(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: IanaTimezone,
): boolean {
  return localDateTimeToUtc(year, month, day, hour, minute, timezone).kind !== 'nonexistent';
}

/**
 * Convert a local date+time string in an IANA timezone to a UTC Date.
 * Returns null if the local time does not exist (DST gap).
 *
 * For ambiguous times, uses the earlier UTC instant.
 */
export function parseLocalDateTimeToUtc(
  date: string, // YYYY-MM-DD
  time: string, // HH:MM
  timezone: IanaTimezone,
): Date | null {
  const dateParts = date.split('-').map(Number);
  const timeParts = time.split(':').map(Number);
  if (
    dateParts.length !== 3 ||
    timeParts.length !== 2 ||
    dateParts.some((n) => !Number.isFinite(n)) ||
    timeParts.some((n) => !Number.isFinite(n))
  ) {
    return null;
  }
  const [year, month, day] = dateParts as [number, number, number];
  const [hour, minute] = timeParts as [number, number];
  const outcome = localDateTimeToUtc(year, month, day, hour, minute, timezone);
  if (outcome.kind === 'nonexistent') return null;
  return outcome.instant;
}
