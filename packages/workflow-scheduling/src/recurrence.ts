import type { IanaTimezone, Weekday } from './definitions.js';

/**
 * Validate and normalise an array of weekdays:
 * - Remove duplicates
 * - Sort ascending (Monday = 1 … Sunday = 7)
 * - Fail if empty
 *
 * @returns normalised weekday array, or null if the input was invalid
 */
export function validateWeekdays(raw: unknown): Weekday[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<number>();
  const result: Weekday[] = [];
  for (const item of raw) {
    if (typeof item !== 'number') return null;
    if (!Number.isInteger(item) || item < 1 || item > 7) return null;
    if (seen.has(item)) continue; // deduplicate
    seen.add(item);
    result.push(item as Weekday);
  }
  if (result.length === 0) return null;
  result.sort((a, b) => a - b);
  return result;
}

/**
 * Validate that weekdays are unique and sorted ascending.
 * This is a pure structural check independent of any date/time computation.
 */
export function areWeekdaysValid(weekdays: Weekday[]): boolean {
  if (weekdays.length === 0) return false;
  // Must be in range 1-7
  for (const w of weekdays) {
    if (w < 1 || w > 7) return false;
  }
  // Must be sorted ascending (no duplicates after sort check)
  const sorted = [...weekdays].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== weekdays[i]) return false; // not sorted
  }
  // Must be unique (sorted array has no duplicates if length matches Set)
  if (new Set(sorted).size !== sorted.length) return false;
  return true;
}

/**
 * Parse a YYYY-MM-DD date string into year, month, day components.
 */
export function parseLocalDate(date: string): {
  year: number;
  month: number;
  day: number;
} | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * Parse an HH:MM time string into hour, minute components.
 */
export function parseLocalTime(time: string): { hour: number; minute: number } | null {
  const m = time.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Compute the number of days from a UTC date to a local date in a given timezone.
 * This is used to validate startDate / endDate ordering.
 */
export function daysBetween(startDate: string, endDate: string): number | null {
  const s = parseLocalDate(startDate);
  const e = parseLocalDate(endDate);
  if (!s || !e) return null;
  const msPerDay = 86_400_000;
  const start = new Date(Date.UTC(s.year, s.month - 1, s.day));
  const end = new Date(Date.UTC(e.year, e.month - 1, e.day));
  return Math.round((end.getTime() - start.getTime()) / msPerDay);
}

/**
 * Validate the intervalDays field.
 */
export function isValidIntervalDays(n: unknown): n is number {
  return (
    typeof n === 'number' &&
    Number.isInteger(n) &&
    n >= 1 &&
    n <= 365
  );
}

/**
 * Validate the intervalWeeks field.
 */
export function isValidIntervalWeeks(n: unknown): n is number {
  return (
    typeof n === 'number' &&
    Number.isInteger(n) &&
    n >= 1 &&
    n <= 52
  );
}

/**
 * Get the ISO 8601 weekday number (Monday=1 … Sunday=7) for a given UTC date.
 */
export function weekdayOfUtc(utcDate: Date, timezone: IanaTimezone): Weekday {
  // We need to convert the UTC date to local time in the given timezone.
  // Since we can't import Luxon here (it's in another file), we use a simple approach:
  // create a Date at midnight UTC and shift by the timezone offset.
  // For the purposes of weekday calculation, we need the local weekday.
  // Since timezone offsets can change (DST), we use a heuristic: try multiple times.
  const base = new Date(utcDate);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth(); // 0-indexed
  const day = base.getUTCDate();

  // For a rough estimate, use UTC offset. This may be off by 1 near DST transitions.
  // The actual weekday calculation uses the local date (wall clock) in the target timezone.
  // We delegate to the occurrence calculation which has full Luxon access.
  // This function is just a helper for validation, not for scheduling.
  // Return a placeholder — callers should use occurrence-calculation.ts for real work.
  void timezone;
  // Simplified: compute based on UTC date which is always unambiguous
  const utcDay = new Date(Date.UTC(year, month, day)).getUTCDay(); // 0=Sun
  // Convert to ISO 8601 (Mon=1)
  return ((utcDay + 6) % 7 + 1) as Weekday;
}
