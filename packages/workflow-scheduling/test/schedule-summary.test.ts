import { describe, expect, it } from 'vitest';

import type { IanaTimezone } from '../src/definitions.js';
import { DailyScheduleDefinitionSchema, WeeklyScheduleDefinitionSchema } from '../src/definitions.js';
import { buildSafeScheduleSummary } from '../src/schedule-summary.js';

const UTC = 'UTC' as IanaTimezone;
const NEW_YORK = 'America/New_York' as IanaTimezone;

describe('schedule-summary', () => {
  describe('buildSafeScheduleSummary', () => {
    it('builds a valid summary for a one-time schedule', () => {
      const summary = buildSafeScheduleSummary(
        'Morning Report',
        {
          schemaVersion: 1,
          type: 'one_time',
          timezone: NEW_YORK,
          date: '2024-06-15',
          time: '08:00',
        },
        'ACTIVE',
        new Date('2024-06-15T12:00:00Z'),
        null,
      );

      expect(summary.name).toBe('Morning Report');
      expect(summary.type).toBe('one_time');
      expect(summary.timezone).toBe('America/New_York');
      expect(summary.localTime).toBe('08:00');
      expect(summary.status).toBe('ACTIVE');
      expect(summary.isComplete).toBe(false);
      expect(summary.isArchived).toBe(false);
      expect(summary.isControllable).toBe(true);
      expect(summary.canResume).toBe(false);
    });

    it('sets canResume for PAUSED schedule', () => {
      const summary = buildSafeScheduleSummary(
        'Test',
        DailyScheduleDefinitionSchema.parse({
          schemaVersion: 1,
          type: 'daily',
          timezone: UTC,
          startDate: '2024-06-01',
          time: '09:00',
        }),
        'PAUSED',
        new Date('2024-06-15T09:00:00Z'),
        new Date('2024-06-14T09:00:00Z'),
      );

      expect(summary.status).toBe('PAUSED');
      expect(summary.canResume).toBe(true);
    });

    it('sets isComplete for COMPLETED schedule', () => {
      const summary = buildSafeScheduleSummary(
        'Test',
        {
          schemaVersion: 1,
          type: 'one_time',
          timezone: UTC,
          date: '2024-06-15',
          time: '10:00',
        },
        'COMPLETED',
        null,
        new Date('2024-06-15T10:00:00Z'),
      );

      expect(summary.status).toBe('COMPLETED');
      expect(summary.isComplete).toBe(true);
      expect(summary.canResume).toBe(false);
      expect(summary.isControllable).toBe(false);
    });

    it('includes autoPauseReason when provided', () => {
      const summary = buildSafeScheduleSummary(
        'Test',
        WeeklyScheduleDefinitionSchema.parse({
          schemaVersion: 1,
          type: 'weekly',
          timezone: UTC,
          startDate: '2024-06-01',
          time: '09:00',
          weekdays: [1],
        }),
        'AUTO_PAUSED',
        null,
        new Date('2024-06-15T09:00:00Z'),
        'ambiguous_outcome',
      );

      expect(summary.status).toBe('AUTO_PAUSED');
      expect(summary.autoPauseReason).toBe('ambiguous_outcome');
      expect(summary.canResume).toBe(true);
    });

    it('formats timestamps as ISO strings', () => {
      const next = new Date('2024-06-15T10:00:00Z');
      const summary = buildSafeScheduleSummary(
        'Test',
        DailyScheduleDefinitionSchema.parse({
          schemaVersion: 1,
          type: 'daily',
          timezone: UTC,
          startDate: '2024-06-01',
          time: '10:00',
        }),
        'ACTIVE',
        next,
        null,
      );

      expect(summary.nextOccurrenceAt).toBe(next.toISOString());
      expect(summary.lastOccurrenceAt).toBeNull();
    });

    it('generates correct recurrence description for daily', () => {
      const summary = buildSafeScheduleSummary(
        'Daily Report',
        DailyScheduleDefinitionSchema.parse({
          schemaVersion: 1,
          type: 'daily',
          timezone: UTC,
          startDate: '2024-06-01',
          time: '09:00',
          intervalDays: 1,
        }),
        'ACTIVE',
        null,
        null,
      );

      expect(summary.recurrenceDescription).toBe('Daily at 09:00');
    });

    it('generates correct recurrence description for daily with interval', () => {
      const summary = buildSafeScheduleSummary(
        'Every 3 Days',
        DailyScheduleDefinitionSchema.parse({
          schemaVersion: 1,
          type: 'daily',
          timezone: UTC,
          startDate: '2024-06-01',
          time: '12:00',
          intervalDays: 3,
        }),
        'ACTIVE',
        null,
        null,
      );

      expect(summary.recurrenceDescription).toBe('Every 3 days at 12:00');
    });

    it('generates correct recurrence description for weekly', () => {
      const summary = buildSafeScheduleSummary(
        'Weekdays',
        WeeklyScheduleDefinitionSchema.parse({
          schemaVersion: 1,
          type: 'weekly',
          timezone: UTC,
          startDate: '2024-06-01',
          time: '09:00',
          weekdays: [1, 2, 3, 4, 5],
        }),
        'ACTIVE',
        null,
        null,
      );

      expect(summary.recurrenceDescription).toBe('Weekly on Mon, Tue, Wed, Thu, Fri at 09:00');
    });

    it('generates correct recurrence description for weekly with interval', () => {
      const summary = buildSafeScheduleSummary(
        'Biweekly Monday',
        WeeklyScheduleDefinitionSchema.parse({
          schemaVersion: 1,
          type: 'weekly',
          timezone: UTC,
          startDate: '2024-06-03',
          time: '09:00',
          weekdays: [1],
          intervalWeeks: 2,
        }),
        'ACTIVE',
        null,
        null,
      );

      expect(summary.recurrenceDescription).toBe('Every 2 weeks on Mon at 09:00');
    });
  });
});
