import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnvironmentPath = fileURLToPath(
  new URL('../../../.env', import.meta.url),
);

if (existsSync(rootEnvironmentPath)) {
  process.loadEnvFile(rootEnvironmentPath);
}

if (process.env.TASKTWIN_ALLOW_DATABASE_RESET !== 'true') {
  throw new Error(
    'Set TASKTWIN_ALLOW_DATABASE_RESET=true to confirm a development reset',
  );
}

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined) {
  throw new Error('DATABASE_URL is required for a development reset');
}

let databaseHost;

try {
  const parsedUrl = new URL(databaseUrl);
  databaseHost = parsedUrl.hostname;

  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
    throw new Error('not PostgreSQL');
  }
} catch {
  throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
}

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

if (!loopbackHosts.has(databaseHost)) {
  throw new Error('Database reset is limited to a local development database');
}

const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(
  pnpmExecutable,
  ['exec', 'prisma', 'migrate', 'reset'],
  {
    stdio: 'inherit',
  },
);

if (result.error !== undefined) {
  throw new Error('Unable to start the Prisma reset command');
}

process.exitCode = result.status ?? 1;
