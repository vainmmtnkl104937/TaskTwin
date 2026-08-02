import { arch, platform } from 'node:process';
import { parseArgs } from 'node:util';
import {
  MAX_EXECUTION_TIMEOUT_MS,
  MIN_EXECUTION_TIMEOUT_MS,
} from '@tasktwin/workflow-engine';
import { MAX_WAIT_DURATION_MS } from '@tasktwin/workflow-schema';

import type { RunnerArchitecture, RunnerPlatform } from './platform-types.js';
import { HttpRunnerControlPlaneTransport } from './control-plane-client.js';
import { FileCredentialStore } from './file-credential-store.js';
import { executeFixtureCommand } from './execution/fixture-command.js';
import { PlaywrightBrowserSessionFactory } from './execution/playwright-browser-session.js';
import { validateControlPlaneOrigin } from './origin.js';
import { LocalRunnerService, systemClock } from './runner-service.js';
import { FileRunnerEncryptionKeyStore } from './secure-inputs/runner-encryption-key-store.js';
import { RunnerKeyManager } from './secure-inputs/runner-key-manager.js';
import { InteractiveSecretProvider } from './secure-inputs/interactive-secret-provider.js';

const RUNNER_VERSION = '0.1.0';

function optionalFixtureWait(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const milliseconds = Number(value);
  if (
    !Number.isInteger(milliseconds) ||
    milliseconds < 1 ||
    milliseconds > MAX_WAIT_DURATION_MS
  ) {
    throw new Error('Fixture wait duration is invalid.');
  }
  return milliseconds;
}

function optionalTotalTimeout(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const milliseconds = Number(value);
  if (
    !Number.isInteger(milliseconds) ||
    milliseconds < MIN_EXECUTION_TIMEOUT_MS ||
    milliseconds > MAX_EXECUTION_TIMEOUT_MS
  ) {
    throw new Error('Fixture total timeout is invalid.');
  }
  return milliseconds;
}

function supportedPlatform(value: string): RunnerPlatform {
  if (value !== 'win32' && value !== 'darwin' && value !== 'linux') {
    throw new Error(
      'This operating system is not supported by the MVP runner.',
    );
  }
  return value;
}

function supportedArchitecture(value: string): RunnerArchitecture {
  if (value !== 'x64' && value !== 'arm64') {
    throw new Error(
      'This processor architecture is not supported by the MVP runner.',
    );
  }
  return value;
}

export async function runCli(
  argv: string[],
  output: { write(message: string): void } = {
    write: (message) => console.info(message),
  },
): Promise<number> {
  const command = argv[0] ?? 'start';
  const parsed = parseArgs({
    args: argv.slice(1),
    options: {
      origin: { type: 'string' },
      name: { type: 'string' },
      headed: { type: 'boolean' },
      attended: { type: 'boolean' },
      'fixture-wait-ms': { type: 'string' },
      'total-timeout-ms': { type: 'string' },
    },
    strict: true,
  });
  const transport = new HttpRunnerControlPlaneTransport();
  const keyManager = new RunnerKeyManager(
    new FileRunnerEncryptionKeyStore(),
    transport,
  );
  const secretProvider = new InteractiveSecretProvider();
  const service = new LocalRunnerService(
    new FileCredentialStore(),
    transport,
    output,
    systemClock,
    RUNNER_VERSION,
    transport,
    new PlaywrightBrowserSessionFactory(),
    keyManager,
    secretProvider,
    {
      headed: parsed.values.headed ?? false,
      attended: parsed.values.attended ?? false,
    },
  );
  switch (command) {
    case 'execute-fixture': {
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      try {
        return await executeFixtureCommand(
          output,
          parsed.values.headed ?? false,
          controller.signal,
          optionalFixtureWait(parsed.values['fixture-wait-ms']),
          optionalTotalTimeout(parsed.values['total-timeout-ms']),
        );
      } finally {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      }
    }
    case 'pair': {
      const origin = validateControlPlaneOrigin(
        parsed.values.origin ?? 'http://127.0.0.1:3001',
      );
      await service.pair({
        origin,
        displayName: parsed.values.name?.trim() || 'TaskTwin Local Runner',
        platform: supportedPlatform(platform),
        architecture: supportedArchitecture(arch),
      });
      return 0;
    }
    case 'status':
      await service.status();
      return 0;
    case 'start': {
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      try {
        await service.start(controller.signal);
      } finally {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      }
      return 0;
    }
    case 'unpair':
      await service.unpair();
      return 0;
    default:
      throw new Error('Unknown Local Runner command.');
  }
}
