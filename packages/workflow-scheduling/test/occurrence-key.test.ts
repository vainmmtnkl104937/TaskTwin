import { describe, expect, it } from 'vitest';

import { buildOccurrenceKey } from '../src/occurrence-key.js';

describe('occurrence-key', () => {
  it('produces a 64-character hex string', () => {
    const key = buildOccurrenceKey(
      '550e8400-e29b-41d4-a716-446655440000',
      new Date('2024-06-15T10:00:00Z'),
    );
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for the same inputs', () => {
    const instant = new Date('2024-06-15T10:00:00.000Z');
    const a = buildOccurrenceKey('550e8400-e29b-41d4-a716-446655440000', instant);
    const b = buildOccurrenceKey('550e8400-e29b-41d4-a716-446655440000', instant);
    expect(a).toBe(b);
  });

  it('differs for different schedule IDs', () => {
    const instant = new Date('2024-06-15T10:00:00Z');
    const a = buildOccurrenceKey('550e8400-e29b-41d4-a716-446655440000', instant);
    const b = buildOccurrenceKey('660f9511-f30c-52e5-b827-557766551111', instant);
    expect(a).not.toBe(b);
  });

  it('differs for different instants', () => {
    const scheduleId = '550e8400-e29b-41d4-a716-446655440000';
    const a = buildOccurrenceKey(scheduleId, new Date('2024-06-15T10:00:00Z'));
    const b = buildOccurrenceKey(scheduleId, new Date('2024-06-15T11:00:00Z'));
    expect(a).not.toBe(b);
  });

  it('uses the same key regardless of sub-millisecond precision', () => {
    const scheduleId = '550e8400-e29b-41d4-a716-446655440000';
    const a = buildOccurrenceKey(scheduleId, new Date('2024-06-15T10:00:00.000Z'));
    const b = buildOccurrenceKey(scheduleId, new Date('2024-06-15T10:00:00.123Z'));
    // Same second → same key
    expect(a).toBe(b);
  });
});
