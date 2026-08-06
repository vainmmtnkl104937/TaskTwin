import { DateTime, IANAZone } from 'luxon';

import type {
  DailyScheduleDefinition,
  IanaTimezone,
  OneTimeScheduleDefinition,
  ScheduleDefinition,
  WeeklyScheduleDefinition,
  Weekday,
} from './definitions.js';
import { localDateTimeToUtc, type DstOutcome } from './timezone.js';

/**
 * Result of computing the next occurrence.
 *
 * scheduledInstant – the UTC Date of the next firing
 * startDeadline   – scheduledInstant + maxStartDelaySeconds
 */
export interface OccurrenceResult {
  readonly scheduledInstant: Date;
  readonly startDeadline: Date;
}

/**
 * An occurrence that could not be scheduled because the local time is invalid.
 */
export interface SkippedOccurrence {
  readonly reason:
    | 'nonexistent_local_time'
    | 'repeated_local_time'
    | 'past_start_date'
    | 'past_end_date';
}

/**
 * Compute the next occurrence instant for a one-time schedule.
 *
 * @param definition  – validated one-time schedule definition
 * @param after       – do not return occurrences at or before this instant
 * @param maxStartDelaySeconds – window width for start deadline
 * @returns the next occurrence, or null if the schedule date is in the past
 */
export function nextOneTimeOccurrence(
  definition: OneTimeScheduleDefinition,
  after: Date,
  maxStartDelaySeconds: number,
): OccurrenceResult | SkippedOccurrence {
  const [year, month, day] = parseDateString(definition.date);
  const [hour, minute] = parseTimeString(definition.time);

  const outcome = localDateTimeToUtc(
    year,
    month,
    day,
    hour,
    minute,
    definition.timezone,
  );

  if (outcome.kind === 'nonexistent') {
    return { reason: 'nonexistent_local_time' };
  }

  // For repeated (ambiguous) times, luxon's handling means we get the earlier instant.
  // We detect if this earlier instant is before `after` (meaning we already
  // processed it) vs if it's after `after`.
  const scheduledInstant = outcome.kind === 'repeated'
    ? outcome.instant
    : (outcome as Extract<DstOutcome, { kind: 'unambiguous' }>).instant;

  if (scheduledInstant <= after) {
    return { reason: 'past_start_date' };
  }

  return {
    scheduledInstant,
    startDeadline: new Date(
      scheduledInstant.getTime() + maxStartDelaySeconds * 1000,
    ),
  };
}

/**
 * Compute the next daily occurrence on or after `after`.
 *
 * @param definition  – validated daily schedule definition
 * @param after       – do not return occurrences at or before this instant
 * @param maxStartDelaySeconds – window width for start deadline
 */
export function nextDailyOccurrence(
  definition: DailyScheduleDefinition,
  after: Date,
  maxStartDelaySeconds: number,
): OccurrenceResult | SkippedOccurrence {
  const [startYear, startMonth, startDay] = parseDateString(definition.startDate);
  const [hour, minute] = parseTimeString(definition.time);

  const endDate = definition.endDate
    ? parseEndDate(definition.endDate)
    : null;

  // Compute the "anchor" local time on startDate
  const anchorOutcome = localDateTimeToUtc(
    startYear,
    startMonth,
    startDay,
    hour,
    minute,
    definition.timezone,
  );
  if (anchorOutcome.kind === 'nonexistent') {
    // Advance start date by 1 day to find a valid anchor
    const nextDay = advanceLocalDate(
      startYear, startMonth, startDay, 1, definition.timezone,
    );
    return nextDailyOccurrence(
      { ...definition, startDate: formatLocalDate(nextDay) },
      after,
      maxStartDelaySeconds,
    );
  }
  if (anchorOutcome.kind === 'repeated') {
    // Ambiguous: use the earlier instant for anchor, but since we're looking
    // for future occurrences this will be the same.
  }

  const anchor = anchorOutcome.kind === 'repeated'
    ? anchorOutcome.instant
    : (anchorOutcome as Extract<DstOutcome, { kind: 'unambiguous' }>).instant;

  // Compute the number of days from anchor to `after` in the schedule's timezone
  const afterInTz = DateTime.fromJSDate(after, {
    zone: definition.timezone,
  });

  const anchorInTz = DateTime.fromJSDate(anchor, {
    zone: definition.timezone,
  });

  // Compute how many intervalDays-aligned days we need to skip to get after the anchor
  const intervalDays = definition.intervalDays;

  // Find the first candidate date >= after
  let candidateLocal = afterInTz.startOf('day');
  const anchorLocal = anchorInTz.startOf('day');

  // Advance in intervalDays steps until we reach or pass the anchor
  // If after is before the anchor, start from the anchor
  if (candidateLocal < anchorLocal) {
    candidateLocal = anchorLocal;
  } else {
    // Align to intervalDays boundary
    const daysSinceAnchor = Math.floor(
      candidateLocal.diff(anchorLocal, 'days').days,
    );
    const remainder = daysSinceAnchor % intervalDays;
    candidateLocal = anchorLocal.plus({
      days: daysSinceAnchor - remainder,
    });
    if (candidateLocal < afterInTz) {
      candidateLocal = candidateLocal.plus({ days: intervalDays });
    }
  }

  // Check end date
  if (endDate) {
    if (candidateLocal > endDate) {
      return { reason: 'past_end_date' };
    }
  }

  // Build the occurrence
  const occurrenceLocal = candidateLocal.set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });

  // If the candidate date's actual firing time has already passed, advance by one
  // interval so we return a future occurrence (e.g. if after is 14th 13:00 UTC and
  // the candidate is 14th 12:00 UTC, the next firing is 15th 12:00 UTC).
  if (occurrenceLocal <= afterInTz) {
    return nextDailyOccurrence(
      definition,
      new Date(occurrenceLocal.toMillis() + 1),
      maxStartDelaySeconds,
    );
  }

  const outcome = localDateTimeToUtc(
    occurrenceLocal.year,
    occurrenceLocal.month,
    occurrenceLocal.day,
    hour,
    minute,
    definition.timezone,
  );

  if (outcome.kind === 'nonexistent') {
    // DST gap: skip this time, try next interval
    return nextDailyOccurrence(
      definition,
      new Date(occurrenceLocal.toMillis() + 3_600_000), // advance 1 hour
      maxStartDelaySeconds,
    );
  }

  if (outcome.kind === 'repeated') {
    // Ambiguous: use the earlier instant (already returned as 'repeated')
    return {
      scheduledInstant: outcome.instant,
      startDeadline: new Date(
        outcome.instant.getTime() + maxStartDelaySeconds * 1000,
      ),
    };
  }

  return {
    scheduledInstant: outcome.instant,
    startDeadline: new Date(
      outcome.instant.getTime() + maxStartDelaySeconds * 1000,
    ),
  };
}

/**
 * Compute the next weekly occurrence on or after `after`.
 *
 * @param definition  – validated weekly schedule definition
 * @param after       – do not return occurrences at or before this instant
 * @param maxStartDelaySeconds – window width for start deadline
 */
export function nextWeeklyOccurrence(
  definition: WeeklyScheduleDefinition,
  after: Date,
  maxStartDelaySeconds: number,
): OccurrenceResult | SkippedOccurrence {
  const weekdays = [...definition.weekdays].sort((a, b) => a - b);
  const intervalWeeks = definition.intervalWeeks;
  const endDate = definition.endDate
    ? parseEndDate(definition.endDate)
    : null;

  const [startYear, startMonth, startDay] = parseDateString(definition.startDate);
  const [hour, minute] = parseTimeString(definition.time);

  // Build the weekly anchor: first occurrence on or after startDate
  // We need to find the first (weekday, week offset) such that:
  // 1. The date is >= startDate
  // 2. The weekday matches one of the selected weekdays
  // 3. The week offset is aligned to intervalWeeks

  const afterInTz = DateTime.fromJSDate(after, {
    zone: definition.timezone,
  });
  const startInTz = DateTime.fromObject(
    { year: startYear, month: startMonth, day: startDay },
    { zone: definition.timezone },
  );

  // Find the first valid weekly occurrence
  let searchDate = afterInTz.startOf('day');
  if (searchDate < startInTz) {
    searchDate = startInTz.startOf('day');
  }

  // We search week by week
  let currentWeekStart = searchDate.startOf('week'); // week starts Monday in Luxon
  const anchorWeekStart = startInTz.startOf('week');
  const weeksSinceAnchor = Math.floor(
    currentWeekStart.diff(anchorWeekStart, 'weeks').weeks,
  );
  // Align to intervalWeeks
  const weeksRemainder = weeksSinceAnchor % intervalWeeks;
  currentWeekStart = anchorWeekStart.plus({
    weeks: weeksSinceAnchor - weeksRemainder,
  });

  const maxSearchWeeks = 52 * 3; // 3 years max search
  for (let i = 0; i < maxSearchWeeks; i++) {
    for (const weekday of weekdays) {
      // Luxon weekday: 1=Mon … 7=Sun
      let candidateDate = currentWeekStart.set({
        weekday: weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7,
        hour,
        minute,
        second: 0,
        millisecond: 0,
      });

      // If weekday is before startDate for the first week, skip
      if (candidateDate < startInTz) continue;

      // Check end date
      if (endDate && candidateDate > endDate) {
        return { reason: 'past_end_date' };
      }

      if (candidateDate <= afterInTz) continue;

      // Check DST
      const outcome = localDateTimeToUtc(
        candidateDate.year,
        candidateDate.month,
        candidateDate.day,
        hour,
        minute,
        definition.timezone,
      );

      if (outcome.kind === 'nonexistent') {
        continue; // DST gap at this time, skip this weekday in this week
      }

      if (outcome.kind === 'repeated') {
        return {
          scheduledInstant: outcome.instant,
          startDeadline: new Date(
            outcome.instant.getTime() + maxStartDelaySeconds * 1000,
          ),
        };
      }

      return {
        scheduledInstant: outcome.instant,
        startDeadline: new Date(
          outcome.instant.getTime() + maxStartDelaySeconds * 1000,
        ),
      };
    }
    currentWeekStart = currentWeekStart.plus({ weeks: intervalWeeks });
  }

  return { reason: 'past_end_date' };
}

/**
 * Dispatcher: compute the next occurrence for any schedule definition.
 */
export function nextOccurrence(
  definition: ScheduleDefinition,
  after: Date,
  maxStartDelaySeconds: number,
): OccurrenceResult | SkippedOccurrence {
  switch (definition.type) {
    case 'one_time':
      return nextOneTimeOccurrence(definition, after, maxStartDelaySeconds);
    case 'daily':
      return nextDailyOccurrence(definition, after, maxStartDelaySeconds);
    case 'weekly':
      return nextWeeklyOccurrence(definition, after, maxStartDelaySeconds);
  }
}

/**
 * Compute the Nth next occurrence.
 */
export function nextNOccurrences(
  definition: ScheduleDefinition,
  after: Date,
  maxStartDelaySeconds: number,
  n: number,
): (OccurrenceResult | SkippedOccurrence)[] {
  const results: (OccurrenceResult | SkippedOccurrence)[] = [];
  let current = after;
  for (let i = 0; i < n; i++) {
    const result = nextOccurrence(definition, current, maxStartDelaySeconds);
    results.push(result);
    if ('reason' in result) break;
    // Advance current to just after this occurrence
    current = new Date(result.scheduledInstant.getTime() + 1);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDateString(date: string): [number, number, number] {
  const parts = date.split('-').map((s) => Number.parseInt(s, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid date string: ${date}`);
  }
  return parts as [number, number, number];
}

function parseTimeString(time: string): [number, number] {
  const parts = time.split(':').map((s) => Number.parseInt(s, 10));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`Invalid time string: ${time}`);
  }
  return parts as [number, number];
}

function parseEndDate(date: string): DateTime {
  const [y, m, d] = parseDateString(date);
  return DateTime.fromObject({ year: y, month: m, day: d }, { zone: 'utc' });
}

function formatLocalDate(dt: DateTime): string {
  return `${dt.year.toString().padStart(4, '0')}-${dt.month.toString().padStart(2, '0')}-${dt.day.toString().padStart(2, '0')}`;
}

/**
 * Advance a local date by N days, handling month/year rollovers.
 */
function advanceLocalDate(
  year: number,
  month: number,
  day: number,
  days: number,
  timezone: IanaTimezone,
): DateTime {
  const dt = DateTime.fromObject(
    { year, month, day },
    { zone: timezone },
  );
  return dt.plus({ days });
}
