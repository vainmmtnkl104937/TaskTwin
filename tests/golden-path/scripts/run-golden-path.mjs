import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const composeFile = resolve(root, 'tests', 'golden-path', 'compose.yaml');
const project = `tasktwin-golden-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const port = await availablePort();
const databaseUrl = `postgresql://tasktwin_e2e:deterministic-local-e2e-password@127.0.0.1:${port}/tasktwin_e2e`;
const environment = {
  ...process.env,
  TASKTWIN_E2E_POSTGRES_PORT: String(port),
  TASKTWIN_E2E_DATABASE_URL: databaseUrl,
  DATABASE_URL: databaseUrl,
  JWT_ACCESS_SECRET: 'golden-path-jwt-secret-with-at-least-32-characters',
  RUNNER_PAIRING_CODE_PEPPER:
    'golden-path-pairing-pepper-with-at-least-32-characters',
  RUNNER_CREDENTIAL_PEPPER:
    'golden-path-credential-pepper-with-at-least-32-characters',
  RUNNER_JOB_LEASE_PEPPER:
    'golden-path-lease-pepper-with-at-least-32-characters',
  TASKTWIN_WEB_BASE_URL: 'http://127.0.0.1:3000',
  TASKTWIN_LOG_LEVEL: 'error',
};

let started = false;
try {
  run('docker', [
    'compose',
    '--project-name',
    project,
    '--file',
    composeFile,
    'up',
    '--detach',
    '--wait',
  ]);
  started = true;
  runPnpm(['--filter', '@tasktwin/database', 'db:migrate:deploy']);
  runPnpm(['--filter', '@tasktwin/database', 'build']);
  runPnpm(['--filter', '@tasktwin/golden-path-e2e', 'test:e2e']);
} finally {
  if (started) {
    run(
      'docker',
      [
        'compose',
        '--project-name',
        project,
        '--file',
        composeFile,
        'down',
        '--volumes',
        '--remove-orphans',
      ],
      false,
    );
  }
}

function run(command, args, required = true) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error !== undefined) throw result.error;
  if (required && result.status !== 0) {
    throw new Error(
      `${command} failed with exit code ${String(result.status ?? 1)}.`,
    );
  }
}

function runPnpm(args) {
  const corepackRoot = process.env.COREPACK_ROOT;
  if (corepackRoot !== undefined) {
    run(process.execPath, [resolve(corepackRoot, 'dist', 'pnpm.js'), ...args]);
    return;
  }
  if (process.platform === 'win32') {
    run(process.env.ComSpec ?? 'cmd.exe', [
      '/d',
      '/s',
      '/c',
      'pnpm.cmd',
      ...args,
    ]);
    return;
  }
  run('pnpm', args);
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate an E2E PostgreSQL port.'));
        return;
      }
      server.close((error) => {
        if (error === undefined) resolvePort(address.port);
        else reject(error);
      });
    });
  });
}
