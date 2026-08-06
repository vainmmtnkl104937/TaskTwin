import { describe, expect, it } from 'vitest';

import type { IanaTimezone } from '../src/definitions.js';
import {
  isValidIanaTimezone,
  validateIanaTimezone,
  localDateTimeToUtc,
  isLocalDateTimeValid,
  parseLocalDateTimeToUtc,
} from '../src/timezone.js';

const UTC = 'UTC' as IanaTimezone;
const NEW_YORK = 'America/New_York' as IanaTimezone;

describe('timezone', () => {
  describe('isValidIanaTimezone', () => {
    it('accepts UTC', () => {
      expect(isValidIanaTimezone('UTC')).toBe(true);
    });

    it('accepts America/New_York', () => {
      expect(isValidIanaTimezone('America/New_York')).toBe(true);
    });

    it('accepts Asia/Tokyo', () => {
      expect(isValidIanaTimezone('Asia/Tokyo')).toBe(true);
    });

    it('rejects invalid timezone', () => {
      expect(isValidIanaTimezone('Invalid/Timezone')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidIanaTimezone('')).toBe(false);
    });
  });

  describe('validateIanaTimezone', () => {
    it('returns the timezone when valid', () => {
      expect(validateIanaTimezone('Europe/London')).toBe('Europe/London');
    });

    it('returns null when invalid', () => {
      expect(validateIanaTimezone('Not/Valid')).toBeNull();
    });
  });

  describe('localDateTimeToUtc', () => {
    it('converts a normal local time to UTC', () => {
      // 2024-06-15 10:00 in UTC has no DST issues
      const result = localDateTimeToUtc(2024, 6, 15, 10, 0, UTC);
      expect(result.kind).toBe('unambiguous');
      if (result.kind === 'unambiguous') {
        const d = result.instant;
        expect(d.getUTCHours()).toBe(10);
        expect(d.getUTCMinutes()).toBe(0);
      }
    });

    it('converts America/New_York correctly in winter (EST)', () => {
      // Jan 15 2024 09:00 EST = 14:00 UTC
      const result = localDateTimeToUtc(2024, 1, 15, 9, 0, NEW_YORK);
      expect(result.kind).toBe('unambiguous');
      if (result.kind === 'unambiguous') {
        expect(result.instant.getUTCHours()).toBe(14);
      }
    });

    it('detects nonexistent time (DST spring-forward gap)', () => {
      // In America/New_York, clocks spring forward from 02:00 to 03:00 in March 2024.
      // So 02:30 doesn't exist on March 10, 2024.
      const result = localDateTimeToUtc(2024, 3, 10, 2, 30, NEW_YORK);
      expect(result.kind).toBe('nonexistent');
    });

    it('detects repeated time (DST fall-back) and returns earlier instant', () => {
      // In America/New_York, clocks fall back from 02:00 to 01:00 in November 2024.
      // So 01:30 occurs twice: once during DST (EDT) and once after (EST).
      // We expect the earlier UTC instant.
      const result = localDateTimeToUtc(2024, 11, 3, 1, 30, NEW_YORK);
      expect(result.kind).toBe('repeated');
      if (result.kind === 'repeated') {
        // The earlier instant is during DST, which is UTC-4
        expect(result.instant.getUTCHours()).toBe(5); // 01:30 EDT = 05:30 UTC
      }
    });

    it('UTC timezone never has DST', () => {
      // Try a nonexistent-looking time at an arbitrary DST boundary
      const result = localDateTimeToUtc(2024, 3, 10, 2, 30, UTC);
      expect(result.kind).toBe('unambiguous');
    });
  });

  describe('isLocalDateTimeValid', () => {
    it('returns true for valid time in UTC', () => {
      expect(isLocalDateTimeValid(2024, 6, 15, 10, 0, UTC)).toBe(true);
    });

    it('returns false for nonexistent DST gap', () => {
      expect(isLocalDateTimeValid(2024, 3, 10, 2, 30, NEW_YORK)).toBe(
        false,
      );
    });

    it('returns true for valid time in DST zone', () => {
      expect(isLocalDateTimeValid(2024, 6, 15, 10, 0, NEW_YORK)).toBe(
        true,
      );
    });
  });

  describe('parseLocalDateTimeToUtc', () => {
    it('parses a valid date and time in UTC', () => {
      const result = parseLocalDateTimeToUtc('2024-06-15', '10:00', UTC);
      expect(result).not.toBeNull();
      expect(result!.getUTCHours()).toBe(10);
      expect(result!.getUTCMinutes()).toBe(0);
    });

    it('returns null for nonexistent DST time', () => {
      const result = parseLocalDateTimeToUtc(
        '2024-03-10',
        '02:30',
        NEW_YORK,
      );
      expect(result).toBeNull();
    });

    it('returns Date for ambiguous DST time (earlier instant)', () => {
      const result = parseLocalDateTimeToUtc(
        '2024-11-03',
        '01:30',
        NEW_YORK,
      );
      expect(result).not.toBeNull();
      // Earlier instant: 01:30 EDT = 05:30 UTC
      expect(result!.getUTCHours()).toBe(5);
    });
  });
});
