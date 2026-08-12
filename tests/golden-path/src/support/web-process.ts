import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

import { waitFor } from './poll.js';

export interface GoldenWebProcess {
  readonly origin: string;
  readonly logs: readonly string[];
  close(): Promise<void>;
}

export async function startGoldenWebProcess(
  apiOrigin: string,
): Promise<GoldenWebProcess> {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const logs: string[] = [];
  const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
  const webRoot = resolve(repositoryRoot, 'apps', 'web');
  const child = spawn(
    process.execPath,
    [
      resolve(webRoot, 'node_modules', 'next', 'dist', 'bin', 'next'),
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        TASKTWIN_API_BASE_URL: apiOrigin,
        TASKTWIN_WEB_BASE_URL: origin,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  collect(child, logs);
  try {
    await waitFor({
      description: 'Web readiness',
      timeoutMs: 30_000,
      intervalMs: 100,
      inspect: async () => {
        if (child.exitCode !== null) {
          const startupLogs = logs.slice(-20).join('').slice(-4_000);
          throw new Error(
            `The golden-path Web process exited early.${startupLogs === '' ? '' : `\n${startupLogs}`}`,
          );
        }
        try {
          const response = await fetch(`${origin}/health/ready`, {
            signal: AbortSignal.timeout(1_000),
          });
          return response.ok ? true : null;
        } catch {
          return null;
        }
      },
    });
  } catch (error: unknown) {
    await stop(child);
    throw error;
  }
  return {
    origin,
    logs,
    close: () => stop(child),
  };
}

function collect(child: ChildProcess, logs: string[]): void {
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding('utf8');
    stream?.on('data', (chunk: string) => {
      logs.push(chunk);
      if (logs.length > 2_000) logs.shift();
    });
  }
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

function availablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a Web E2E port.'));
        return;
      }
      server.close((error) =>
        error === undefined ? resolvePort(address.port) : reject(error),
      );
    });
  });
}
