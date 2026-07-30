import { arch, platform } from 'node:process';
import { parseArgs } from 'node:util';

import type { RunnerArchitecture, RunnerPlatform } from './platform-types.js';
import { HttpRunnerControlPlaneTransport } from './control-plane-client.js';
import { FileCredentialStore } from './file-credential-store.js';
import { validateControlPlaneOrigin } from './origin.js';
import { LocalRunnerService, systemClock } from './runner-service.js';

const RUNNER_VERSION = '0.1.0';

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
): Promise<void> {
  const command = argv[0] ?? 'start';
  const parsed = parseArgs({
    args: argv.slice(1),
    options: {
      origin: { type: 'string' },
      name: { type: 'string' },
    },
    strict: true,
  });
  const service = new LocalRunnerService(
    new FileCredentialStore(),
    new HttpRunnerControlPlaneTransport(),
    output,
    systemClock,
    RUNNER_VERSION,
  );
  switch (command) {
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
      return;
    }
    case 'status':
      await service.status();
      return;
    case 'start': {
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      try {
        await service.start(controller.signal);
      } finally {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
      }
      return;
    }
    case 'unpair':
      await service.unpair();
      return;
    default:
      throw new Error('Unknown Local Runner command.');
  }
}
