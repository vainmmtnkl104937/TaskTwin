import { arch, platform } from 'node:process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
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
import { FileLocalSecretVaultStore } from './secrets/local-secret-vault-store.js';
import { LocalSecretVaultService } from './secrets/local-secret-vault-service.js';
import { LocalVaultSecretProvider } from './secrets/local-vault-secret-provider.js';
import { NodeScryptMasterKeyProtector } from './secrets/node-secret-crypto.js';
import { TerminalNoEchoPrompt } from './secrets/no-echo-prompt.js';
import { RunnerLocalSecretRuntime } from './secrets/local-secret-runtime.js';
import { runSecretsCli } from './secrets/secrets-cli.js';
import {
  WINDOWS_NATIVE_PROTECTION_DESCRIPTOR,
  WindowsNativeMasterKeyProtector,
} from './platform/windows/windows-native-master-key-protector.js';
import { WindowsRunnerServiceManager } from './platform/windows/windows-service-manager.js';
import { readWindowsRunnerServiceConfig } from './platform/windows/windows-service-manager.js';
import { runServiceCli } from './service/service-cli.js';
import { FileRunnerInstanceLock } from './runtime/runner-instance-lock.js';
import type { RunnerRuntimeMode } from '@tasktwin/runner-service-runtime';
import {
  formatRunnerVersion,
  readEmbeddedBuildIdentity,
  reportedSoftwareIdentity,
} from './release/build-identity.js';
import { runReleaseCli } from './release/release-cli.js';
import type { TrustedReleaseKey } from '@tasktwin/runner-release';

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
  dependencies: {
    readBuildIdentity?: typeof readEmbeddedBuildIdentity;
    trustedReleaseKeys?: readonly TrustedReleaseKey[] | undefined;
  } = {},
): Promise<number> {
  const readBuildIdentity =
    dependencies.readBuildIdentity ?? readEmbeddedBuildIdentity;
  const command = argv[0] ?? 'start';
  if (command === 'version') {
    if (argv.length !== 1)
      throw new Error('Runner version takes no arguments.');
    output.write(formatRunnerVersion(await readBuildIdentity()));
    return 0;
  }
  if (command === 'release' || command === 'upgrade') {
    return runReleaseCli({
      argv,
      buildIdentity: await readBuildIdentity(),
      output,
      trustedKeys: dependencies.trustedReleaseKeys,
    });
  }
  const serviceBootstrap =
    command === 'service-run'
      ? parseArgs({
          args: argv.slice(1),
          options: { 'service-config': { type: 'string' } },
          strict: true,
        })
      : null;
  const serviceCommand =
    command === 'service' ? parseServiceCommandArguments(argv.slice(1)) : null;
  const serviceConfig =
    serviceBootstrap === null
      ? null
      : await readWindowsRunnerServiceConfig(
          serviceBootstrap.values['service-config'] ?? '',
        );
  if (
    serviceConfig !== null &&
    (serviceConfig.nodeExecutable !== process.execPath ||
      serviceConfig.runnerEntryPoint !==
        fileURLToPath(new URL('./index.js', import.meta.url)))
  ) {
    throw new Error('The Windows service executable binding is invalid.');
  }
  const dataRoot =
    serviceConfig?.dataRoot ?? serviceCommand?.dataRoot ?? homedir();
  const transport = new HttpRunnerControlPlaneTransport();
  const credentialStore = new FileCredentialStore(dataRoot);
  const prompt = new TerminalNoEchoPrompt();
  const nativeProtector = new WindowsNativeMasterKeyProtector(
    WINDOWS_NATIVE_PROTECTION_DESCRIPTOR,
  );
  const vaultService = new LocalSecretVaultService(
    new FileLocalSecretVaultStore(dataRoot),
    [new NodeScryptMasterKeyProtector(), nativeProtector],
  );
  if (command === 'service') {
    return runServiceCli({
      args: serviceCommand?.operations ?? [],
      credentials: credentialStore,
      manager: new WindowsRunnerServiceManager(
        fileURLToPath(new URL('./index.js', import.meta.url)),
        dataRoot,
      ),
      output,
    });
  }
  if (command === 'secrets') {
    return runSecretsCli({
      args: argv.slice(1),
      credentials: credentialStore,
      vault: vaultService,
      prompt,
      transport,
      output,
    });
  }
  const parsed = parseArgs({
    args: argv.slice(1),
    options: {
      origin: { type: 'string' },
      name: { type: 'string' },
      headed: { type: 'boolean' },
      attended: { type: 'boolean' },
      'fixture-wait-ms': { type: 'string' },
      'total-timeout-ms': { type: 'string' },
      'runtime-mode': { type: 'string' },
      'service-config': { type: 'string' },
    },
    strict: true,
  });
  const runtimeMode = determineRuntimeMode({
    command,
    requested: parsed.values['runtime-mode'],
    headed: parsed.values.headed ?? false,
    attended: parsed.values.attended ?? false,
  });
  if (command === 'execute-fixture') {
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
  const buildIdentity = await readBuildIdentity();
  const serviceManager =
    serviceConfig === null
      ? null
      : new WindowsRunnerServiceManager(
          serviceConfig.runnerEntryPoint,
          serviceConfig.dataRoot,
        );
  const serviceVerified =
    serviceConfig === null
      ? false
      : await serviceManager!.verifyRunning(serviceConfig);
  const keyManager = new RunnerKeyManager(
    new FileRunnerEncryptionKeyStore(dataRoot),
    transport,
  );
  const secretProvider =
    runtimeMode === 'service' ? undefined : new InteractiveSecretProvider();
  const localVaultProvider = new LocalVaultSecretProvider(vaultService);
  const localSecretRuntime = new RunnerLocalSecretRuntime(
    vaultService,
    prompt,
    transport,
    output,
    runtimeMode,
  );
  const service = new LocalRunnerService(
    credentialStore,
    transport,
    output,
    systemClock,
    buildIdentity.version,
    transport,
    new PlaywrightBrowserSessionFactory(),
    keyManager,
    secretProvider,
    {
      headed: parsed.values.headed ?? false,
      attended: parsed.values.attended ?? false,
    },
    localSecretRuntime,
    localVaultProvider,
    {
      runtimeMode,
      serviceVerified,
      nativeProtectorAvailable: await nativeProtector.isAvailable(),
      drainTimeoutMilliseconds: 60_000,
    },
    reportedSoftwareIdentity(buildIdentity),
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
      return 0;
    }
    case 'status':
      await service.status();
      return 0;
    case 'start':
    case 'service-run': {
      const credential = await credentialStore.load();
      if (credential === null)
        throw new Error('The Local Runner is not paired.');
      if (
        serviceConfig !== null &&
        serviceConfig.runnerDeviceId !== credential.runnerDeviceId
      ) {
        throw new Error('The local service Runner binding is invalid.');
      }
      if (command === 'service-run' && !serviceVerified) {
        throw new Error(
          'The Windows service configuration could not be verified.',
        );
      }
      const instance = await new FileRunnerInstanceLock(dataRoot).acquire(
        credential.runnerDeviceId,
      );
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      try {
        await service.start(controller.signal);
      } finally {
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
        await instance.release();
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

export function parseServiceCommandArguments(args: string[]): {
  operations: string[];
  dataRoot: string | undefined;
} {
  const parsed = parseArgs({
    args,
    options: { 'data-root': { type: 'string' } },
    allowPositionals: true,
    strict: true,
  });
  return {
    operations: parsed.positionals,
    dataRoot: parsed.values['data-root'],
  };
}

export function determineRuntimeMode(input: {
  command: string;
  requested: string | undefined;
  headed: boolean;
  attended: boolean;
}): RunnerRuntimeMode {
  if (input.command === 'service-run') {
    if (input.headed || input.attended || input.requested !== undefined) {
      throw new Error('Service mode rejects interactive execution options.');
    }
    return 'service';
  }
  if (input.requested !== undefined) {
    if (
      input.requested !== 'interactive' &&
      input.requested !== 'unattended_process'
    ) {
      throw new Error('Runner runtime mode is invalid.');
    }
    if (
      input.requested === 'unattended_process' &&
      (input.headed || input.attended)
    ) {
      throw new Error(
        'Unattended process mode rejects interactive execution options.',
      );
    }
    return input.requested;
  }
  return input.headed || input.attended ? 'interactive' : 'unattended_process';
}
