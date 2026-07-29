import { describe, expect, it } from 'vitest';

import { getRequiredDatabaseUrl } from '../src/database-url.js';

describe('getRequiredDatabaseUrl', () => {
  it('returns a configured PostgreSQL URL', () => {
    const databaseUrl = 'postgresql://tasktwin:local@localhost:5432/tasktwin';

    expect(getRequiredDatabaseUrl({ DATABASE_URL: databaseUrl })).toBe(
      databaseUrl,
    );
  });

  it('rejects missing configuration without exposing credentials', () => {
    expect(() => getRequiredDatabaseUrl({})).toThrow(
      'DATABASE_URL is required',
    );
  });

  it('rejects a non-PostgreSQL URL', () => {
    expect(() =>
      getRequiredDatabaseUrl({
        DATABASE_URL: 'https://example.test/database',
      }),
    ).toThrow('DATABASE_URL must use the postgresql protocol');
  });
});
