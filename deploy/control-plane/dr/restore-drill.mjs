import { createServer } from 'node:net';
import {
  copyFile,
  mkdtemp,
  mkdir,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const drillId = `tasktwin-dr-${Date.now()}-${randomBytes(3).toString('hex')}`;
const sourceContainer = `${drillId}-source`;
const restoreContainer = `${drillId}-restore`;
const sourceVolume = `${drillId}-source-data`;
const restoreVolume = `${drillId}-restore-data`;
const network = `${drillId}-network`;
const postgresUser = 'tasktwin_drill';
const sourceDatabase = 'tasktwin_source';
const restoreDatabase = 'tasktwin_restore';
const password = randomBytes(32).toString('base64url');
const runnerPepper = randomBytes(32).toString('base64url');
const runnerCredential = randomBytes(32).toString('base64url');
const pnpmCli = process.env.npm_execpath;
if (pnpmCli === undefined || !pnpmCli.endsWith('.cjs')) {
  throw new Error('DRILL_PNPM_CLI_UNAVAILABLE');
}
const tempRoot = await mkdtemp(join(tmpdir(), 'tasktwin-drill-'));
const backupDirectory = join(tempRoot, 'backups');
const passwordFile = join(tempRoot, 'postgres-password');
let apiProcess;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    timeout: options.timeout ?? 180_000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    const safeOutput =
      `${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`.slice(
        -4_000,
      );
    throw new Error(
      `DRILL_COMMAND_FAILED command=${command} output=${safeOutput}`,
    );
  }
  return (result.stdout ?? '').trim();
}

function runExpectFailure(command, args, expectedCode, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    timeout: options.timeout ?? 180_000,
    windowsHide: true,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.status === 0 || !output.includes(expectedCode)) {
    throw new Error(`DRILL_EXPECTED_FAILURE_MISSING code=${expectedCode}`);
  }
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'string' || address === null) {
        server.close();
        reject(new Error('DRILL_PORT_ALLOCATION_FAILED'));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitForPostgres(container) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = spawnSync(
      'docker',
      ['exec', container, 'pg_isready', '-U', postgresUser],
      { encoding: 'utf8', windowsHide: true },
    );
    if (result.status === 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error('DRILL_POSTGRES_NOT_READY');
}

async function waitForApi(port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (apiProcess?.exitCode !== null) throw new Error('DRILL_API_EXITED');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
      if (response.ok) return;
    } catch {
      // Startup connection failures are expected until the listener is ready.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error('DRILL_API_NOT_READY');
}

function databaseUrl(port, database) {
  return `postgresql://${postgresUser}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`;
}

async function stopApi() {
  if (apiProcess === undefined || apiProcess.exitCode !== null) return;
  apiProcess.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => apiProcess.once('exit', resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ]);
  if (apiProcess.exitCode === null) apiProcess.kill('SIGKILL');
}

async function cleanup() {
  await stopApi();
  spawnSync('docker', ['rm', '--force', sourceContainer, restoreContainer], {
    stdio: 'ignore',
    windowsHide: true,
  });
  spawnSync(
    'docker',
    ['volume', 'rm', '--force', sourceVolume, restoreVolume],
    {
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  spawnSync('docker', ['network', 'rm', network], {
    stdio: 'ignore',
    windowsHide: true,
  });
  await rm(tempRoot, { recursive: true, force: true });
}

try {
  await mkdir(backupDirectory, { recursive: true });
  await writeFile(passwordFile, `${password}\n`, { mode: 0o600 });
  run('docker', ['version']);
  run(process.execPath, [pnpmCli, '--filter', '@tasktwin/database', 'build']);
  run(process.execPath, [pnpmCli, '--filter', '@tasktwin/api', 'build']);
  run(process.execPath, [
    pnpmCli,
    '--filter',
    '@tasktwin/notification-worker',
    'build',
  ]);
  run('docker', ['network', 'create', network]);
  run('docker', ['volume', 'create', sourceVolume]);
  run('docker', ['volume', 'create', restoreVolume]);
  const sourcePort = await freePort();
  const restorePort = await freePort();
  const postgresImage = 'postgres:17.10-alpine';
  const commonPostgresArgs = (name, port, volume, database) => [
    'run',
    '--detach',
    '--name',
    name,
    '--network',
    network,
    '--publish',
    `127.0.0.1:${port}:5432`,
    '--mount',
    `type=volume,src=${volume},dst=/var/lib/postgresql/data`,
    '--mount',
    `type=bind,src=${passwordFile},dst=/run/secrets/postgres-password,readonly`,
    '--env',
    `POSTGRES_USER=${postgresUser}`,
    '--env',
    `POSTGRES_DB=${database}`,
    '--env',
    'POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password',
    postgresImage,
  ];
  run(
    'docker',
    commonPostgresArgs(
      sourceContainer,
      sourcePort,
      sourceVolume,
      sourceDatabase,
    ),
  );
  run(
    'docker',
    commonPostgresArgs(
      restoreContainer,
      restorePort,
      restoreVolume,
      restoreDatabase,
    ),
  );
  await Promise.all([
    waitForPostgres(sourceContainer),
    waitForPostgres(restoreContainer),
  ]);

  const sourceUrl = databaseUrl(sourcePort, sourceDatabase);
  const restoreUrl = databaseUrl(restorePort, restoreDatabase);
  run('node', ['packages/database/scripts/migrate-deploy.mjs'], {
    env: { DATABASE_URL: sourceUrl },
  });
  const seedOutput = run(
    'node',
    ['packages/database/scripts/seed-drill-database.mjs'],
    {
      env: {
        DATABASE_URL: sourceUrl,
        RUNNER_CREDENTIAL_PEPPER: runnerPepper,
        DRILL_RUNNER_CREDENTIAL: runnerCredential,
      },
    },
  );
  const fixture = JSON.parse(seedOutput.split(/\r?\n/u).at(-1));

  const drDirectory = join(repositoryRoot, 'deploy/control-plane/dr');
  run('docker', [
    'run',
    '--rm',
    '--network',
    network,
    '--mount',
    `type=bind,src=${drDirectory},dst=/dr,readonly`,
    '--mount',
    `type=bind,src=${backupDirectory},dst=/backups`,
    '--mount',
    `type=bind,src=${passwordFile},dst=/run/secrets/postgres-password,readonly`,
    '--env',
    `PGHOST=${sourceContainer}`,
    '--env',
    'PGPORT=5432',
    '--env',
    `POSTGRES_USER=${postgresUser}`,
    '--env',
    `POSTGRES_DB=${sourceDatabase}`,
    '--env',
    'TASKTWIN_POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password',
    '--env',
    'TASKTWIN_BACKUP_ROOT=/backups',
    '--env',
    'TASKTWIN_BACKUP_REASON=drill',
    postgresImage,
    'sh',
    '/dr/backup.sh',
  ]);
  const backupFiles = (await readdir(backupDirectory)).filter((name) =>
    name.endsWith('.dump'),
  );
  if (backupFiles.length !== 1) throw new Error('DRILL_BACKUP_SET_INVALID');
  const backupRef = backupFiles[0];

  const restoreArguments = (restoreRef) => [
    'run',
    '--rm',
    '--network',
    network,
    '--mount',
    `type=bind,src=${drDirectory},dst=/dr,readonly`,
    '--mount',
    `type=bind,src=${backupDirectory},dst=/backups,readonly`,
    '--mount',
    `type=bind,src=${passwordFile},dst=/run/secrets/postgres-password,readonly`,
    '--env',
    `PGHOST=${restoreContainer}`,
    '--env',
    'PGPORT=5432',
    '--env',
    `POSTGRES_USER=${postgresUser}`,
    '--env',
    `POSTGRES_DB=${restoreDatabase}`,
    '--env',
    `TASKTWIN_RESTORE_CONFIRM_DATABASE=${restoreDatabase}`,
    '--env',
    `TASKTWIN_RESTORE_BACKUP_REF=${restoreRef}`,
    '--env',
    'TASKTWIN_POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password',
    '--env',
    'TASKTWIN_BACKUP_ROOT=/backups',
    postgresImage,
    'sh',
    '/dr/restore.sh',
  ];
  const tamperedRef = 'tasktwin-postgresql-v1-19990101T000000Z-drill.dump';
  await copyFile(
    join(backupDirectory, backupRef),
    join(backupDirectory, tamperedRef),
  );
  await copyFile(
    join(backupDirectory, `${backupRef}.json`),
    join(backupDirectory, `${tamperedRef}.json`),
  );
  await writeFile(
    join(backupDirectory, `${tamperedRef}.sha256`),
    `${'0'.repeat(64)}  ${tamperedRef}\n`,
  );
  runExpectFailure(
    'docker',
    restoreArguments(tamperedRef),
    'RESTORE_CHECKSUM_MISMATCH',
  );
  await Promise.all([
    rm(join(backupDirectory, tamperedRef)),
    rm(join(backupDirectory, `${tamperedRef}.sha256`)),
    rm(join(backupDirectory, `${tamperedRef}.json`)),
  ]);

  run('docker', restoreArguments(backupRef));
  runExpectFailure(
    'docker',
    restoreArguments(backupRef),
    'RESTORE_TARGET_NOT_CLEAN',
  );
  run('node', ['packages/database/scripts/migrate-deploy.mjs'], {
    env: { DATABASE_URL: restoreUrl },
  });
  run('node', ['packages/database/scripts/verify-restored-database.mjs'], {
    env: { DATABASE_URL: restoreUrl },
  });

  for (const timestamp of [
    '20000101T000001Z',
    '20000101T000002Z',
    '20000101T000003Z',
    '20000101T000004Z',
  ]) {
    const retainedBase = `tasktwin-postgresql-v1-${timestamp}-drill.dump`;
    await copyFile(
      join(backupDirectory, backupRef),
      join(backupDirectory, retainedBase),
    );
    await copyFile(
      join(backupDirectory, `${backupRef}.sha256`),
      join(backupDirectory, `${retainedBase}.sha256`),
    );
    await copyFile(
      join(backupDirectory, `${backupRef}.json`),
      join(backupDirectory, `${retainedBase}.json`),
    );
  }
  run('docker', [
    'run',
    '--rm',
    '--mount',
    `type=bind,src=${drDirectory},dst=/dr,readonly`,
    '--mount',
    `type=bind,src=${backupDirectory},dst=/backups`,
    '--env',
    'TASKTWIN_BACKUP_ROOT=/backups',
    postgresImage,
    'sh',
    '/dr/retention.sh',
  ]);
  const retainedDrillDumps = (await readdir(backupDirectory)).filter((name) =>
    /^tasktwin-postgresql-v1-\d{8}T\d{6}Z-drill\.dump$/u.test(name),
  );
  if (
    retainedDrillDumps.length !== 3 ||
    !retainedDrillDumps.includes(backupRef)
  ) {
    throw new Error('DRILL_RETENTION_POLICY_FAILED');
  }

  const apiPort = await freePort();
  apiProcess = spawn('node', ['apps/api/dist/main.js'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      API_HOST: '127.0.0.1',
      API_PORT: String(apiPort),
      DATABASE_URL: restoreUrl,
      TASKTWIN_WEB_BASE_URL: 'http://127.0.0.1:3000',
      JWT_ACCESS_SECRET: randomBytes(32).toString('base64url'),
      RUNNER_PAIRING_CODE_PEPPER: randomBytes(32).toString('base64url'),
      RUNNER_CREDENTIAL_PEPPER: runnerPepper,
      RUNNER_JOB_LEASE_PEPPER: randomBytes(32).toString('base64url'),
      TASKTWIN_LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  await waitForApi(apiPort);
  const heartbeat = await fetch(
    `http://127.0.0.1:${apiPort}/runner/heartbeat`,
    {
      method: 'POST',
      headers: {
        authorization: `TaskTwinRunner ${fixture.runnerDeviceId}.${runnerCredential}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        schemaVersion: 1,
        runnerVersion: '0.1.0',
        capabilities: [],
      }),
    },
  );
  if (!heartbeat.ok)
    throw new Error(`DRILL_RUNNER_RECONNECT_FAILED_${heartbeat.status}`);
  await stopApi();

  const recoveryOutput = run(
    'node',
    ['packages/database/scripts/verify-drill-recovery.mjs'],
    { env: { DATABASE_URL: restoreUrl } },
  );
  console.log(
    `DR_DRILL_COMPLETE backup=${backupRef} checksum=ok tamperReject=ok cleanTargetGuard=ok retention=ok apiReadiness=ok runnerReconnect=ok recovery=ok`,
  );
  console.log(recoveryOutput.split(/\r?\n/u).at(-1));
} finally {
  await cleanup();
}
