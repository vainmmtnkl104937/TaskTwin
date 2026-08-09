import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RunnerStartupStatus } from '@tasktwin/runner-update';
import { afterEach, describe, expect, it } from 'vitest';

import { runnerWindowsServiceName } from '../platform/windows/windows-service-identity.js';
import type {
  WindowsRunnerServiceActivationConfig,
  WindowsRunnerServiceActivationProof,
  WindowsRunnerServiceState,
} from '../platform/windows/windows-service-manager.js';
import { runnerInstallationPaths } from './installation-layout.js';
import type { VerifiedInstalledRelease } from './installed-release-store.js';
import { WindowsRunnerUpdateServiceController } from './windows-update-service-controller.js';

const RUNNER_ID = '753ff8fc-4267-4d99-b741-41485f5bab45';
const ACTIVATION_ID = `ru1_${'a'.repeat(64)}`;
const MANIFEST_SHA256 = 'b'.repeat(64);
const SOFTWARE_IDENTITY = {
  product: 'tasktwin-runner' as const,
  version: '1.4.0',
  runnerProtocolVersion: 2,
  workflowSchemaVersion: 1,
  localStateSchemaVersion: 1,
  platform: 'windows' as const,
  architecture: 'x64' as const,
};
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Windows Runner update service controller', () => {
  it('ensures a pre-switch service non-disruptively, then requires a fresh attempt for post-switch health', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tasktwin-update-health-'));
    directories.push(directory);
    const dataRoot = join(directory, 'data');
    const paths = runnerInstallationPaths({
      programData: directory,
      runnerDeviceId: RUNNER_ID,
    });
    const artifactFileName = 'tasktwin-runner-1.4.0-windows-x64.zip';
    const payload = join(directory, 'installed', 'payload');
    const activationDirectory = join(directory, 'installed', 'activation');
    const payloadRoot = join(payload, artifactFileName.slice(0, -4));
    const nodeExecutable = join(payloadRoot, 'runtime', 'node.exe');
    const runnerEntryPoint = join(payloadRoot, 'dist', 'index.js');
    const identityPath = join(
      payloadRoot,
      'dist',
      'release',
      'build-identity.json',
    );
    await Promise.all([
      mkdir(join(payloadRoot, 'runtime'), { recursive: true }),
      mkdir(join(payloadRoot, 'dist', 'release'), { recursive: true }),
      mkdir(activationDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(nodeExecutable, 'node'),
      writeFile(runnerEntryPoint, 'runner'),
      writeFile(
        identityPath,
        JSON.stringify({
          ...SOFTWARE_IDENTITY,
          sourceCommit: 'c'.repeat(40),
          localSecretVaultSchemaVersion: 1,
        }),
      ),
    ]);

    const serviceName = runnerWindowsServiceName(RUNNER_ID);
    const serviceExecutablePath = join(
      activationDirectory,
      `${serviceName}.exe`,
    );
    const activationConfigPath = join(
      activationDirectory,
      'runner-service-activation.v1.json',
    );
    const activation: WindowsRunnerServiceActivationConfig = {
      schemaVersion: 1,
      activationId: ACTIVATION_ID,
      releaseVersion: '1.4.0',
      manifestSha256: MANIFEST_SHA256,
      serviceName,
      runnerDeviceId: RUNNER_ID,
      dataRoot,
      nodeExecutable,
      runnerEntryPoint,
      serviceConfigPath: join(activationDirectory, 'runner-service.v1.json'),
      serviceExecutablePath,
      serviceXmlPath: join(activationDirectory, `${serviceName}.xml`),
      startupStatusPath: paths.startupStatus,
      updateJournalPath: paths.journal,
      logDirectory: paths.logs,
      softwareIdentity: SOFTWARE_IDENTITY,
      requireNativeSecretAutoUnlock: false,
    };
    await writeFile(activationConfigPath, JSON.stringify(activation));

    const staleAttemptId = 'stale_startup_attempt';
    const freshAttemptId = 'fresh_startup_attempt';
    let startupStatus: RunnerStartupStatus = healthyStatus(staleAttemptId);
    let state: WindowsRunnerServiceState = 'running';
    let stopCalls = 0;
    let startCalls = 0;
    let receivedProof: WindowsRunnerServiceActivationProof | undefined;
    const proof: WindowsRunnerServiceActivationProof = {
      activationId: ACTIVATION_ID,
      activationConfigPath,
      activationConfigSha256: 'd'.repeat(64),
      serviceConfigPath: activation.serviceConfigPath,
      serviceConfigSha256: 'e'.repeat(64),
      serviceExecutablePath,
      serviceExecutableSha256: 'f'.repeat(64),
      serviceXmlPath: activation.serviceXmlPath,
      serviceXmlSha256: '1'.repeat(64),
      criticalRuntimeFiles: [
        { path: nodeExecutable, sha256: '2'.repeat(64) },
        { path: runnerEntryPoint, sha256: '3'.repeat(64) },
        { path: identityPath, sha256: '4'.repeat(64) },
      ],
    };
    const manager = {
      prepareActivation:
        async (): Promise<WindowsRunnerServiceActivationConfig> => activation,
      attestActivation:
        async (): Promise<WindowsRunnerServiceActivationProof> => proof,
      currentBinaryPath: async (): Promise<string> => serviceExecutablePath,
      status: async (): Promise<WindowsRunnerServiceState> => state,
      stopAndWait: async (): Promise<void> => {
        stopCalls += 1;
        state = 'stopped';
      },
      startAndWait: async (
        _runnerDeviceId: string,
        _timeoutMilliseconds?: number,
        activationProof?: WindowsRunnerServiceActivationProof,
      ): Promise<void> => {
        startCalls += 1;
        receivedProof = activationProof;
        if (state === 'stopped') {
          state = 'running';
          startupStatus = healthyStatus(freshAttemptId);
        }
      },
      rebindBinaryPath: async (): Promise<void> => undefined,
    };
    const controller = new WindowsRunnerUpdateServiceController(
      RUNNER_ID,
      dataRoot,
      paths,
      manager,
      { read: async () => startupStatus },
      directory,
    );
    const installedRelease = {
      record: {
        version: '1.4.0',
        manifestSha256: MANIFEST_SHA256,
        artifact: { fileName: artifactFileName },
      },
      paths: { payload, activation: activationDirectory },
    } as unknown as VerifiedInstalledRelease;
    const loadedActivation = await controller.loadActivation(installedRelease);

    await controller.ensureRunning();
    expect(stopCalls).toBe(0);
    expect(startCalls).toBe(1);
    expect(startupStatus.startupAttemptId).toBe(staleAttemptId);

    const health = await controller.verifyHealth({
      installedRelease,
      activation: loadedActivation,
      requireNativeSecretAutoUnlock: false,
      timeoutMilliseconds: 100,
    });

    expect(health.decision).toBe('healthy');
    expect(stopCalls).toBe(1);
    expect(startCalls).toBe(2);
    expect(receivedProof).toBe(proof);
    expect(startupStatus.startupAttemptId).toBe(freshAttemptId);
  });
});

function healthyStatus(startupAttemptId: string): RunnerStartupStatus {
  return {
    schemaVersion: 1,
    activationId: ACTIVATION_ID,
    startupAttemptId,
    softwareIdentity: SOFTWARE_IDENTITY,
    state: 'healthy',
    observedAt: '2026-08-09T00:00:00.000Z',
    acceptsNewJobs: false,
    activeWork: false,
    checks: {
      identity: 'passed',
      instanceLock: 'passed',
      workflowEngine: 'passed',
      policyRuntime: 'passed',
      chromium: 'passed',
      localSecretStore: 'passed',
      nativeSecretAutoUnlock: 'not_required',
    },
    controlPlaneAcknowledgement: 'offline',
  };
}
