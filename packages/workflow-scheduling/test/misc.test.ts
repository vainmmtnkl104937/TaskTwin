import { describe, expect, it } from 'vitest';

import { SchedulingError } from '../src/scheduling-errors.js';
import {
  validateWeekdays,
  areWeekdaysValid,
  parseLocalDate,
  parseLocalTime,
  daysBetween,
  isValidIntervalDays,
  isValidIntervalWeeks,
} from '../src/recurrence.js';

describe('scheduling-errors', () => {
  it('SchedulingError has code and message', () => {
    const err = new SchedulingError('RUNTIME_INPUT_REQUIRED', 'A runtime input is required.');
    expect(err.code).toBe('RUNTIME_INPUT_REQUIRED');
    expect(err.message).toBe('A runtime input is required.');
    expect(err.name).toBe('SchedulingError');
  });

  it('SchedulingError.toJSON() includes details', () => {
    const err = new SchedulingError('POLICY_DENIED', 'Policy denied.', { stepId: 'step-1' });
    const json = err.toJSON();
    expect(json).toEqual({
      code: 'POLICY_DENIED',
      message: 'Policy denied.',
      details: { stepId: 'step-1' },
    });
  });
});

describe('recurrence helpers', () => {
  describe('parseLocalDate', () => {
    it('parses valid date', () => {
      expect(parseLocalDate('2024-06-15')).toEqual({ year: 2024, month: 6, day: 15 });
    });

    it('returns null for invalid format', () => {
      expect(parseLocalDate('06/15/2024')).toBeNull();
    });

    it('returns null for invalid month', () => {
      expect(parseLocalDate('2024-13-01')).toBeNull();
    });

    it('returns null for invalid day', () => {
      expect(parseLocalDate('2024-06-32')).toBeNull();
    });
  });

  describe('parseLocalTime', () => {
    it('parses valid time', () => {
      expect(parseLocalTime('09:30')).toEqual({ hour: 9, minute: 30 });
    });

    it('parses 00:00', () => {
      expect(parseLocalTime('00:00')).toEqual({ hour: 0, minute: 0 });
    });

    it('returns null for invalid hour', () => {
      expect(parseLocalTime('25:00')).toBeNull();
    });

    it('returns null for invalid minute', () => {
      expect(parseLocalTime('09:60')).toBeNull();
    });
  });

  describe('daysBetween', () => {
    it('returns 0 for same date', () => {
      expect(daysBetween('2024-06-15', '2024-06-15')).toBe(0);
    });

    it('returns positive for future date', () => {
      expect(daysBetween('2024-06-01', '2024-06-15')).toBe(14);
    });

    it('returns negative for past date', () => {
      expect(daysBetween('2024-06-15', '2024-06-01')).toBe(-14);
    });

    it('returns null for invalid dates', () => {
      expect(daysBetween('invalid', '2024-06-15')).toBeNull();
    });
  });

  describe('isValidIntervalDays', () => {
    it('accepts 1', () => expect(isValidIntervalDays(1)).toBe(true));
    it('accepts 365', () => expect(isValidIntervalDays(365)).toBe(true));
    it('rejects 0', () => expect(isValidIntervalDays(0)).toBe(false));
    it('rejects 366', () => expect(isValidIntervalDays(366)).toBe(false));
    it('rejects non-integer', () => expect(isValidIntervalDays(1.5)).toBe(false));
    it('rejects negative', () => expect(isValidIntervalDays(-1)).toBe(false));
  });

  describe('isValidIntervalWeeks', () => {
    it('accepts 1', () => expect(isValidIntervalWeeks(1)).toBe(true));
    it('accepts 52', () => expect(isValidIntervalWeeks(52)).toBe(true));
    it('rejects 0', () => expect(isValidIntervalWeeks(0)).toBe(false));
    it('rejects 53', () => expect(isValidIntervalWeeks(53)).toBe(false));
    it('rejects non-integer', () => expect(isValidIntervalWeeks(2.5)).toBe(false));
  });
});
