import { spawn } from 'node:child_process';
import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { createRequire } from 'node:module';

const MAXIMUM_SECRET_FILE_BYTES = 8_192;

function resolveDatabaseUrl() {
  const direct = process.env.DATABASE_URL;
  const file = process.env.DATABASE_URL_FILE;
  if (direct !== undefined && file !== undefined) {
    throw new Error('DATABASE_CONFIGURATION_AMBIGUOUS');
  }
  if (direct !== undefined && direct.trim() !== '') return direct;
  if (file === undefined || file.trim() === '') {
    throw new Error('DATABASE_CONFIGURATION_MISSING');
  }

  let descriptor;
  try {
    const linkStatus = lstatSync(file);
    if (
      linkStatus.isSymbolicLink() ||
      !linkStatus.isFile() ||
      linkStatus.size > MAXIMUM_SECRET_FILE_BYTES
    ) {
      throw new Error('DATABASE_SECRET_FILE_INVALID');
    }
    descriptor = openSync(file, 'r');
    const status = fstatSync(descriptor);
    if (!status.isFile() || status.size > MAXIMUM_SECRET_FILE_BYTES) {
      throw new Error('DATABASE_SECRET_FILE_INVALID');
    }
    const buffer = Buffer.alloc(status.size + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytesRead !== status.size) {
      throw new Error('DATABASE_SECRET_FILE_CHANGED');
    }
    const value = buffer
      .subarray(0, bytesRead)
      .toString('utf8')
      .replace(/[\r\n]+$/u, '');
    if (value.trim() === '') throw new Error('DATABASE_CONFIGURATION_MISSING');
    return value;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('DATABASE_'))
      throw error;
    throw new Error('DATABASE_SECRET_FILE_UNREADABLE');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

try {
  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js');
  const environment = { ...process.env };
  delete environment.DATABASE_URL_FILE;
  const child = spawn(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--config', 'prisma.config.ts'],
    {
      cwd: new URL('..', import.meta.url),
      env: { ...environment, DATABASE_URL: resolveDatabaseUrl() },
      stdio: 'inherit',
    },
  );
  child.once('error', () => {
    console.error('DATABASE_MIGRATION_START_FAILED');
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    process.exitCode = code ?? (signal === null ? 1 : 128);
  });
} catch {
  console.error('DATABASE_MIGRATION_CONFIGURATION_INVALID');
  process.exitCode = 1;
}
