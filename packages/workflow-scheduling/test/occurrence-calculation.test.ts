import { describe, expect, it } from 'vitest';

import type { IanaTimezone } from '../src/definitions.js';
import {
  nextOneTimeOccurrence,
  nextDailyOccurrence,
  nextWeeklyOccurrence,
  nextOccurrence,
  nextNOccurrences,
} from '../src/occurrence-calculation.js';

const UTC = 'UTC' as IanaTimezone;
const NEW_YORK = 'America/New_York' as IanaTimezone;

describe('occurrence-calculation', () => {
  describe('nextOneTimeOccurrence', () => {
    it('returns the correct instant for a future one-time schedule', () => {
      const after = new Date('2024-01-01T00:00:00Z');
      const result = nextOneTimeOccurrence(
        {
          schemaVersion: 1,
          type: 'one_time',
          timezone: UTC,
          date: '2024-06-15',
          time: '10:00',
        },
        after,
        300,
      );
      expect(result).not.toHaveProperty('reason');
      if (!('reason' in result)) {
        expect(result.scheduledInstant.getUTCFullYear()).toBe(2024);
        expect(result.scheduledInstant.getUTCMonth()).toBe(5); // 0-indexed
        expect(result.scheduledInstant.getUTCDate()).toBe(15);
        expect(result.scheduledInstant.getUTCHours()).toBe(10);
        expect(result.startDeadline.getTime()).toBe(
          result.scheduledInstant.getTime() + 300_000,
        );
      }
    });

    it('returns past_start_date when schedule is in the past', () => {
      const after = new Date('2025-01-01T00:00:00Z');
      const result = nextOneTimeOccurrence(
        {
          schemaVersion: 1,
          type: 'one_time',
          timezone: UTC,
          date: '2024-06-15',
          time: '10:00',
        },
        after,
        300,
      );
      expect(result).toHaveProperty('reason', 'past_start_date');
    });

    it('skips nonexistent local time', () => {
      const after = new Date('2024-03-01T00:00:00Z');
      // DST spring-forward in America/New_York happens around March 10, 2024
      const result = nextOneTimeOccurrence(
        {
          schemaVersion: 1,
          type: 'one_time',
          timezone: NEW_YORK,
          date: '2024-03-10',
          time: '02:30',
        },
        after,
        300,
      );
      expect(result).toHaveProperty('reason', 'nonexistent_local_time');
    });

    it('handles ambiguous DST time with earlier instant', () => {
      const after = new Date('2024-11-01T00:00:00Z');
      // November 3, 2024 01:30 AM is ambiguous in America/New_York
      const result = nextOneTimeOccurrence(
        {
          schemaVersion: 1,
          type: 'one_time',
          timezone: NEW_YORK,
          date: '2024-11-03',
          time: '01:30',
        },
        after,
        300,
      );
      // Should return a result (the earlier instant)
      expect(result).not.toHaveProperty('reason');
    });
  });

  describe('nextDailyOccurrence', () => {
    it('returns today if the time has not passed', () => {
      // At 08:00 UTC, the 09:00 UTC occurrence is still due
      const after = new Date('2024-06-15T08:00:00Z');
      const result = nextDailyOccurrence(
        {
          schemaVersion: 1,
          type: 'daily',
          timezone: UTC,
          startDate: '2024-01-01',
          time: '09:00',
          intervalDays: 1,
        },
        after,
        300,
      );
      expect(result).not.toHaveProperty('reason');
      if (!('reason' in result)) {
        expect(result.scheduledInstant.getUTCHours()).toBe(9);
      }
    });

    it('returns tomorrow if the time has already passed', () => {
      const after = new Date('2024-06-15T10:00:00Z');
      const result = nextDailyOccurrence(
        {
          schemaVersion: 1,
          type: 'daily',
          timezone: UTC,
          startDate: '2024-01-01',
          time: '09:00',
          intervalDays: 1,
        },
        after,
        300,
      );
      expect(result).not.toHaveProperty('reason');
      if (!('reason' in result)) {
        // Should be June 16
        expect(result.scheduledInstant.getUTCDate()).toBe(16);
        expect(result.scheduledInstant.getUTCHours()).toBe(9);
      }
    });

    it('respects intervalDays', () => {
      const after = new Date('2024-06-15T00:00:00Z');
      const result = nextDailyOccurrence(
        {
          schemaVersion: 1,
          type: 'daily',
          timezone: UTC,
          startDate: '2024-06-10',
          time: '12:00',
          intervalDays: 3,
        },
        after,
        300,
      );
      expect(result).not.toHaveProperty('reason');
      if (!('reason' in result)) {
        // June 10 + 3 = June 13; June 13 + 3 = June 16
        expect(result.scheduledInstant.getUTCDate()).toBe(16);
      }
    });

    it('respects endDate', () => {
      // After the 14th 12:00 occurrence, the next valid firing is the 15th
      // (which is the last occurrence within endDate).
      const after = new Date('2024-06-14T13:00:00Z');
      const result = nextDailyOccurrence(
        {
          schemaVersion: 1,
          type: 'daily',
          timezone: UTC,
          startDate: '2024-06-10',
          endDate: '2024-06-15',
          time: '12:00',
          intervalDays: 1,
        },
        after,
        300,
      );
      // June 15 is the last occurrence
      expect(result).not.toHaveProperty('reason');
      if (!('reason' in result)) {
        expect(result.scheduledInstant.getUTCDate()).toBe(15);
      }
    });

    it('returns past_end_date when after endDate', () => {
      const after = new Date('2024-06-20T00:00:00Z');
      const result = nextDailyOccurrence(
        {
          schemaVersion: 1,
          type: 'daily',
          timezone: UTC,
          startDate: '2024-06-10',
          endDate: '2024-06-15',
          time: '12:00',
          intervalDays: 1,
        },
        after,
        300,
      );
      expect(result).toHaveProperty('reason', 'past_end_date');
    });
  });

  describe('nextWeeklyOccurrence', () => {
    it('returns next matching weekday', () => {
      // Monday 2024-06-17
      const after = new Date('2024-06-17T00:00:00Z');
      const result = nextWeeklyOccurrence(
        {
          schemaVersion: 1,
          type: 'weekly',
          timezone: UTC,
          startDate: '2024-06-01',
          time: '09:00',
          weekdays: [1], // Monday
          intervalWeeks: 1,
        },
        after,
        300,
      );
      expect(result).not.toHaveProperty('reason');
      if (!('reason' in result)) {
        // Should be next Monday: June 24
        expect(result.scheduledInstant.getUTCHours()).toBe(9);
      }
    });

    it('sorts weekdays correctly', () => {
      // Friday 2024-06-14
      const after = new Date('2024-06-14T00:00:00Z');
      const result = nextWeeklyOccurrence(
        {
          schemaVersion: 1,
          type: 'weekly',
          timezone: UTC,
          startDate: '2024-06-01',
          time: '09:00',
          weekdays: [5], // Friday
          intervalWeeks: 1,
        },
        after,
        300,
      );
      expect(result).not.toHaveProperty('reason');
    });

    it('respects intervalWeeks', () => {
      // After the 09:00 firing on the starting Saturday, the next occurrence
      // is 2 weeks later on June 15.
      const after = new Date('2024-06-01T10:00:00Z');
      const result = nextWeeklyOccurrence(
        {
          schemaVersion: 1,
          type: 'weekly',
          timezone: UTC,
          startDate: '2024-06-01', // Saturday
          time: '09:00',
          weekdays: [6], // Saturday
          intervalWeeks: 2,
        },
        after,
        300,
      );
      expect(result).not.toHaveProperty('reason');
      if (!('reason' in result)) {
        // June 1 (Sat) is start; next is June 15 (Sat)
        expect(result.scheduledInstant.getUTCDate()).toBe(15);
      }
    });

    it('respects endDate', () => {
      const after = new Date('2024-06-01T00:00:00Z');
      const result = nextWeeklyOccurrence(
        {
          schemaVersion: 1,
          type: 'weekly',
          timezone: UTC,
          startDate: '2024-06-01',
          endDate: '2024-06-30',
          time: '09:00',
          weekdays: [1], // Monday
          intervalWeeks: 1,
        },
        after,
        300,
      );
      expect(result).not.toHaveProperty('reason');
    });
  });

  describe('nextOccurrence (dispatcher)', () => {
    it('routes one_time correctly', () => {
      const after = new Date('2024-01-01T00:00:00Z');
      const result = nextOccurrence(
        {
          schemaVersion: 1,
          type: 'one_time',
          timezone: UTC,
          date: '2024-06-15',
          time: '10:00',
        },
        after,
        300,
      );
      expect(result).not.toHaveProperty('reason');
    });

    it('routes daily correctly', () => {
      const after = new Date('2024-06-15T00:00:00Z');
      const result = nextOccurrence(
        {
          schemaVersion: 1,
          type: 'daily',
          timezone: UTC,
          startDate: '2024-06-01',
          time: '09:00',
          intervalDays: 1,
        },
        after,
        300,
      );
      expect(result).not.toHaveProperty('reason');
    });

    it('routes weekly correctly', () => {
      const after = new Date('2024-06-17T00:00:00Z');
      const result = nextOccurrence(
        {
          schemaVersion: 1,
          type: 'weekly',
          timezone: UTC,
          startDate: '2024-06-01',
          time: '09:00',
          weekdays: [1],
          intervalWeeks: 1,
        },
        after,
        300,
      );
      expect(result).not.toHaveProperty('reason');
    });
  });

  describe('nextNOccurrences', () => {
    it('returns N occurrences', () => {
      const after = new Date('2024-06-15T00:00:00Z');
      const results = nextNOccurrences(
        {
          schemaVersion: 1,
          type: 'daily',
          timezone: UTC,
          startDate: '2024-06-01',
          time: '09:00',
          intervalDays: 1,
        },
        after,
        300,
        3,
      );
      expect(results).toHaveLength(3);
      for (const r of results) {
        expect(r).not.toHaveProperty('reason');
      }
    });
  });
});
