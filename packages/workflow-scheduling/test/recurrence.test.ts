import { describe, expect, it } from 'vitest';

import { validateWeekdays, areWeekdaysValid } from '../src/recurrence.js';

describe('recurrence', () => {
  describe('validateWeekdays', () => {
    it('accepts a valid weekday array', () => {
      expect(validateWeekdays([1, 3, 5])).toEqual([1, 3, 5]);
    });

    it('deduplicates weekdays', () => {
      expect(validateWeekdays([1, 1, 2, 2, 3])).toEqual([1, 2, 3]);
    });

    it('sorts weekdays ascending', () => {
      expect(validateWeekdays([5, 2, 7, 1])).toEqual([1, 2, 5, 7]);
    });

    it('rejects empty array', () => {
      expect(validateWeekdays([])).toBeNull();
    });

    it('rejects non-array input', () => {
      expect(validateWeekdays('1,2,3')).toBeNull();
      expect(validateWeekdays(null)).toBeNull();
      expect(validateWeekdays(undefined)).toBeNull();
    });

    it('rejects out-of-range weekdays', () => {
      expect(validateWeekdays([0])).toBeNull();
      expect(validateWeekdays([8])).toBeNull();
      expect(validateWeekdays([-1])).toBeNull();
    });

    it('rejects non-integer weekdays', () => {
      expect(validateWeekdays([1.5])).toBeNull();
      expect(validateWeekdays([1, 2.5])).toBeNull();
    });
  });

  describe('areWeekdaysValid', () => {
    it('returns true for valid sorted weekdays', () => {
      expect(areWeekdaysValid([1])).toBe(true);
      expect(areWeekdaysValid([1, 2, 3])).toBe(true);
      expect(areWeekdaysValid([1, 2, 3, 4, 5, 6, 7])).toBe(true);
    });

    it('returns false for empty array', () => {
      expect(areWeekdaysValid([])).toBe(false);
    });

    it('returns false for unsorted weekdays', () => {
      expect(areWeekdaysValid([3, 1])).toBe(false);
    });

    it('returns false for duplicate weekdays', () => {
      expect(areWeekdaysValid([1, 1, 2])).toBe(false);
    });

    it('returns false for out-of-range weekdays', () => {
      expect(areWeekdaysValid([1, 8])).toBe(false);
    });
  });
});
