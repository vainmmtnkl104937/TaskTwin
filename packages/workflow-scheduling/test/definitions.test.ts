import { describe, expect, it } from 'vitest';

import {
  ScheduleDefinitionSchema,
  OneTimeScheduleDefinitionSchema,
  DailyScheduleDefinitionSchema,
  WeeklyScheduleDefinitionSchema,
  IanaTimezoneSchema,
  LocalDateSchema,
  LocalTimeSchema,
  WeekdaySchema,
  WorkflowScheduleStatusSchema,
  WorkflowScheduleOccurrenceStatusSchema,
  ScheduleSkipReasonSchema,
  ScheduleAutoPauseReasonSchema,
} from '../src/index.js';

describe('definitions', () => {
  describe('IanaTimezoneSchema', () => {
    it('accepts UTC', () => {
      expect(IanaTimezoneSchema.parse('UTC')).toBe('UTC');
    });

    it('accepts America/New_York', () => {
      expect(IanaTimezoneSchema.parse('America/New_York')).toBe(
        'America/New_York',
      );
    });

    it('rejects invalid timezone', () => {
      expect(() => IanaTimezoneSchema.parse('Invalid/Zone')).toThrow();
    });

    it('rejects empty string', () => {
      expect(() => IanaTimezoneSchema.parse('')).toThrow();
    });
  });

  describe('LocalDateSchema', () => {
    it('accepts valid YYYY-MM-DD', () => {
      expect(LocalDateSchema.parse('2024-06-15')).toBe('2024-06-15');
    });

    it('rejects invalid month', () => {
      expect(() => LocalDateSchema.parse('2024-13-01')).toThrow();
    });

    it('rejects invalid day', () => {
      expect(() => LocalDateSchema.parse('2024-06-32')).toThrow();
    });

    it('rejects wrong format', () => {
      expect(() => LocalDateSchema.parse('06/15/2024')).toThrow();
    });
  });

  describe('LocalTimeSchema', () => {
    it('accepts 00:00', () => {
      expect(LocalTimeSchema.parse('00:00')).toBe('00:00');
    });

    it('accepts 23:59', () => {
      expect(LocalTimeSchema.parse('23:59')).toBe('23:59');
    });

    it('rejects 24:00', () => {
      expect(() => LocalTimeSchema.parse('24:00')).toThrow();
    });

    it('rejects 12:60', () => {
      expect(() => LocalTimeSchema.parse('12:60')).toThrow();
    });
  });

  describe('WeekdaySchema', () => {
    it('accepts 1-7', () => {
      expect(WeekdaySchema.parse(1)).toBe(1);
      expect(WeekdaySchema.parse(7)).toBe(7);
    });

    it('rejects 0', () => {
      expect(() => WeekdaySchema.parse(0)).toThrow();
    });

    it('rejects 8', () => {
      expect(() => WeekdaySchema.parse(8)).toThrow();
    });
  });

  describe('OneTimeScheduleDefinitionSchema', () => {
    it('parses a valid one-time schedule', () => {
      const result = OneTimeScheduleDefinitionSchema.parse({
        schemaVersion: 1,
        type: 'one_time',
        timezone: 'America/New_York',
        date: '2024-06-15',
        time: '10:00',
      });
      expect(result.type).toBe('one_time');
      expect(result.timezone).toBe('America/New_York');
      expect(result.date).toBe('2024-06-15');
    });

    it('rejects unknown schemaVersion', () => {
      expect(() =>
        OneTimeScheduleDefinitionSchema.parse({
          schemaVersion: 99,
          type: 'one_time',
          timezone: 'UTC',
          date: '2024-06-15',
          time: '10:00',
        }),
      ).toThrow();
    });

    it('rejects unknown type', () => {
      expect(() =>
        OneTimeScheduleDefinitionSchema.parse({
          schemaVersion: 1,
          type: 'cron',
          timezone: 'UTC',
          date: '2024-06-15',
          time: '10:00',
        }),
      ).toThrow();
    });

    it('rejects unknown timezone', () => {
      expect(() =>
        OneTimeScheduleDefinitionSchema.parse({
          schemaVersion: 1,
          type: 'one_time',
          timezone: 'Invalid/Zone',
          date: '2024-06-15',
          time: '10:00',
        }),
      ).toThrow();
    });
  });

  describe('DailyScheduleDefinitionSchema', () => {
    it('parses a valid daily schedule with defaults', () => {
      const result = DailyScheduleDefinitionSchema.parse({
        schemaVersion: 1,
        type: 'daily',
        timezone: 'UTC',
        startDate: '2024-06-01',
        time: '09:00',
      });
      expect(result.intervalDays).toBe(1);
      expect(result.endDate).toBeUndefined();
    });

    it('parses with intervalDays and endDate', () => {
      const result = DailyScheduleDefinitionSchema.parse({
        schemaVersion: 1,
        type: 'daily',
        timezone: 'UTC',
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        time: '09:00',
        intervalDays: 7,
      });
      expect(result.intervalDays).toBe(7);
      expect(result.endDate).toBe('2024-06-30');
    });

    it('rejects endDate before startDate', () => {
      expect(() =>
        DailyScheduleDefinitionSchema.parse({
          schemaVersion: 1,
          type: 'daily',
          timezone: 'UTC',
          startDate: '2024-06-30',
          endDate: '2024-06-01',
          time: '09:00',
          intervalDays: 1,
        }),
      ).toThrow();
    });

    it('rejects intervalDays out of range', () => {
      expect(() =>
        DailyScheduleDefinitionSchema.parse({
          schemaVersion: 1,
          type: 'daily',
          timezone: 'UTC',
          startDate: '2024-06-01',
          time: '09:00',
          intervalDays: 366,
        }),
      ).toThrow();
    });
  });

  describe('WeeklyScheduleDefinitionSchema', () => {
    it('parses a valid weekly schedule with defaults', () => {
      const result = WeeklyScheduleDefinitionSchema.parse({
        schemaVersion: 1,
        type: 'weekly',
        timezone: 'UTC',
        startDate: '2024-06-01',
        time: '09:00',
      });
      expect(result.weekdays).toEqual([1]);
      expect(result.intervalWeeks).toBe(1);
    });

    it('sorts and deduplicates weekdays', () => {
      const result = WeeklyScheduleDefinitionSchema.parse({
        schemaVersion: 1,
        type: 'weekly',
        timezone: 'UTC',
        startDate: '2024-06-01',
        time: '09:00',
        weekdays: [3, 1, 5, 1, 3], // [3, 1, 5, 1, 3] → [1, 3, 5]
      });
      expect(result.weekdays).toEqual([1, 3, 5]);
    });

    it('rejects empty weekdays', () => {
      expect(() =>
        WeeklyScheduleDefinitionSchema.parse({
          schemaVersion: 1,
          type: 'weekly',
          timezone: 'UTC',
          startDate: '2024-06-01',
          time: '09:00',
          weekdays: [],
        }),
      ).toThrow();
    });
  });

  describe('ScheduleDefinitionSchema (union)', () => {
    it('accepts one_time', () => {
      const result = ScheduleDefinitionSchema.parse({
        schemaVersion: 1,
        type: 'one_time',
        timezone: 'UTC',
        date: '2024-06-15',
        time: '10:00',
      });
      expect(result.type).toBe('one_time');
    });

    it('accepts daily', () => {
      const result = ScheduleDefinitionSchema.parse({
        schemaVersion: 1,
        type: 'daily',
        timezone: 'UTC',
        startDate: '2024-06-01',
        time: '09:00',
      });
      expect(result.type).toBe('daily');
    });

    it('accepts weekly', () => {
      const result = ScheduleDefinitionSchema.parse({
        schemaVersion: 1,
        type: 'weekly',
        timezone: 'UTC',
        startDate: '2024-06-01',
        time: '09:00',
        weekdays: [1, 3, 5],
      });
      expect(result.type).toBe('weekly');
    });
  });
});

describe('schedule-status', () => {
  describe('WorkflowScheduleStatusSchema', () => {
    it('accepts all valid statuses', () => {
      const statuses = [
        'ACTIVE',
        'PAUSED',
        'AUTO_PAUSED',
        'COMPLETED',
        'ARCHIVED',
      ];
      for (const s of statuses) {
        expect(WorkflowScheduleStatusSchema.parse(s)).toBe(s);
      }
    });

    it('rejects unknown status', () => {
      expect(() => WorkflowScheduleStatusSchema.parse('RUNNING')).toThrow();
    });
  });

  describe('WorkflowScheduleOccurrenceStatusSchema', () => {
    it('accepts all valid statuses', () => {
      const statuses = [
        'PENDING',
        'DISPATCHED',
        'SUCCEEDED',
        'SKIPPED',
        'TIMED_OUT',
        'CANCELLED',
      ];
      for (const s of statuses) {
        expect(WorkflowScheduleOccurrenceStatusSchema.parse(s)).toBe(s);
      }
    });
  });

  describe('ScheduleSkipReasonSchema', () => {
    it('accepts all valid skip reasons', () => {
      const reasons = [
        'schedule_overlap',
        'runner_busy',
        'runner_unavailable',
        'runner_update_required',
        'policy_denied',
        'source_version_unavailable',
        'missed_start_window',
        'nonexistent_local_time',
        'repeated_local_time',
      ];
      for (const r of reasons) {
        expect(ScheduleSkipReasonSchema.parse(r)).toBe(r);
      }
    });
  });

  describe('ScheduleAutoPauseReasonSchema', () => {
    it('accepts all valid auto-pause reasons', () => {
      const reasons = [
        'policy_review_required',
        'source_version_unavailable',
        'ambiguous_outcome',
        'runner_update_required',
      ];
      for (const r of reasons) {
        expect(ScheduleAutoPauseReasonSchema.parse(r)).toBe(r);
      }
    });
  });
});
