import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getRequiredDatabaseUrl } from '../src/database-url.js';

describe('getRequiredDatabaseUrl', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories) {
      rmSync(directory, { recursive: true, force: true });
    }
    temporaryDirectories.length = 0;
  });

  it('returns a configured PostgreSQL URL', () => {
    const databaseUrl = 'postgresql://tasktwin:local@localhost:5432/tasktwin';

    expect(getRequiredDatabaseUrl({ DATABASE_URL: databaseUrl })).toBe(
      databaseUrl,
    );
  });

  it('rejects missing configuration without exposing credentials', () => {
    expect(() => getRequiredDatabaseUrl({})).toThrow(
      'DATABASE_URL or DATABASE_URL_FILE is required',
    );
  });

  it('rejects a non-PostgreSQL URL', () => {
    expect(() =>
      getRequiredDatabaseUrl({
        DATABASE_URL: 'https://example.test/database',
      }),
    ).toThrow('DATABASE_URL must use the postgresql protocol');
  });

  it('reads a bounded database URL from a regular secret file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tasktwin-db-secret-'));
    temporaryDirectories.push(directory);
    const file = join(directory, 'database-url');
    writeFileSync(
      file,
      'postgresql://tasktwin:file-secret@postgres/tasktwin\n',
    );

    expect(getRequiredDatabaseUrl({ DATABASE_URL_FILE: file })).toBe(
      'postgresql://tasktwin:file-secret@postgres/tasktwin',
    );
  });

  it('rejects ambiguous secret inputs without exposing values', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tasktwin-db-secret-'));
    temporaryDirectories.push(directory);
    const target = join(directory, 'target');
    writeFileSync(target, 'postgresql://tasktwin:hidden@postgres/tasktwin');

    expect(() =>
      getRequiredDatabaseUrl({
        DATABASE_URL: 'postgresql://tasktwin:direct@postgres/tasktwin',
        DATABASE_URL_FILE: target,
      }),
    ).toThrow('DATABASE_URL and DATABASE_URL_FILE are mutually exclusive');
  });

  it.skipIf(process.platform === 'win32')(
    'rejects symbolic-link secret inputs',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'tasktwin-db-secret-'));
      temporaryDirectories.push(directory);
      const target = join(directory, 'target');
      const link = join(directory, 'link');
      writeFileSync(target, 'postgresql://tasktwin:hidden@postgres/tasktwin');
      symlinkSync(target, link);

      expect(() => getRequiredDatabaseUrl({ DATABASE_URL_FILE: link })).toThrow(
        'DATABASE_URL_FILE must reference a regular file',
      );
    },
  );
});
