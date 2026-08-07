import { describe, expect, it } from 'vitest';
import { retryDelaySeconds } from '../src/retry-policy.js';

describe('bounded notification retry policy', () => {
  it('increases deterministically and stops after five attempts', () => {
    expect([1, 2, 3, 4, 5].map(retryDelaySeconds)).toEqual([15, 60, 300, 900, null]);
  });
});
