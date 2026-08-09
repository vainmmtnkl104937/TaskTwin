import { fileURLToPath } from 'node:url';

import type { TrustedReleaseKey } from '@tasktwin/runner-release';

import { FileCredentialStore } from '../file-credential-store.js';
import { WindowsRunnerServiceManager } from '../platform/windows/windows-service-manager.js';
import { WindowsRunnerInstallationAclBoundary } from '../platform/windows/windows-runner-installation-acl.js';
import { FileRunnerStartupStatusStore } from '../runtime/startup-status-store.js';
import { WindowsReleaseArchiveExtractor } from './archive-extractor.js';
import { runnerInstallationPaths } from './installation-layout.js';
import { FileInstalledReleaseStore } from './installed-release-store.js';
import { RunnerUpdateController } from './update-controller.js';
import { FileRunnerUpdateDrainCoordinator } from './update-drain-coordinator.js';
import { FileRunnerUpdateLock } from './update-lock.js';
import {
  FileActiveReleaseStore,
  FileRunnerUpdateJournalStore,
} from './update-record-stores.js';
import { WindowsRunnerUpdateServiceController } from './windows-update-service-controller.js';

export async function createLocalRunnerUpdateController(input: {
  readonly dataRoot: string;
  readonly runnerEntryPoint: string;
  readonly trustedKeys: readonly TrustedReleaseKey[];
  readonly programData?: string;
}): Promise<RunnerUpdateController> {
  const credential = await new FileCredentialStore(input.dataRoot).load();
  if (credential === null) {
    throw new Error('The Local Runner is not paired.');
  }
  const programData = input.programData ?? process.env['ProgramData'];
  if (process.platform !== 'win32' || programData === undefined) {
    throw new Error('Runner update is supported only on Windows.');
  }
  const paths = runnerInstallationPaths({
    programData,
    runnerDeviceId: credential.runnerDeviceId,
  });
  const extractor = new WindowsReleaseArchiveExtractor(
    fileURLToPath(new URL('./windows-release-archive.ps1', import.meta.url)),
  );
  const status = new FileRunnerStartupStatusStore(paths.startupStatus);
  const securityBoundary = new WindowsRunnerInstallationAclBoundary({
    root: paths.root,
    runnerDeviceId: credential.runnerDeviceId,
    scriptPath: fileURLToPath(
      new URL(
        '../platform/windows/windows-runner-installation-acl.ps1',
        import.meta.url,
      ),
    ),
  });
  const manager = new WindowsRunnerServiceManager(
    input.runnerEntryPoint,
    input.dataRoot,
    programData,
  );
  return new RunnerUpdateController({
    dataRoot: input.dataRoot,
    trustedKeys: input.trustedKeys,
    lock: new FileRunnerUpdateLock(
      paths.updateLock,
      undefined,
      securityBoundary,
    ),
    installedReleases: new FileInstalledReleaseStore(
      paths,
      extractor,
      input.trustedKeys,
      securityBoundary,
    ),
    activeRelease: new FileActiveReleaseStore(paths.activeRelease),
    journal: new FileRunnerUpdateJournalStore(paths.journal),
    drain: new FileRunnerUpdateDrainCoordinator(status),
    service: new WindowsRunnerUpdateServiceController(
      credential.runnerDeviceId,
      input.dataRoot,
      paths,
      manager,
      status,
      programData,
      securityBoundary,
    ),
  });
}
