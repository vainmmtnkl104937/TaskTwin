import { describe, expect, it } from 'vitest';

import { normalizeEmail } from '../src/identity/normalize-email.js';

describe('normalizeEmail', () => {
  it('trims surrounding whitespace and lowercases once at the shared boundary', () => {
    expect(normalizeEmail('  Person.Name@Example.COM  ')).toBe(
      'person.name@example.com',
    );
  });
});
