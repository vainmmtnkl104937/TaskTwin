import { describe, expect, it } from 'vitest';

import { decodeTimeIdCursor, encodeTimeIdCursor } from './time-id-cursor.js';

describe('time/id cursor', () => {
  it('round-trips a stable timestamp and UUID tuple', () => {
    const input = {
      time: new Date('2026-08-12T12:00:00.123Z'),
      id: '00000000-0000-4000-8000-000000000037',
    };
    expect(decodeTimeIdCursor(encodeTimeIdCursor(input))).toEqual(input);
  });

  it.each(['not-base64', Buffer.from('{}').toString('base64url')])(
    'rejects malformed cursor %s',
    (cursor) => {
      expect(() => decodeTimeIdCursor(cursor)).toThrow();
    },
  );
});
