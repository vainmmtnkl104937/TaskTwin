import {
  InstalledReleaseRecordSchema,
  RunnerUpdateJournalSchema,
  type InstalledReleaseRecord,
  type RunnerUpdateJournal,
} from './contracts.js';
import type { RunnerUpdateErrorCode } from './errors.js';

export interface SafeRunnerUpdateSummary {
  updateId: string;
  operation: RunnerUpdateJournal['operation'];
  state: RunnerUpdateJournal['state'];
  fromVersion: string;
  targetVersion: string;
  startedAt: string;
  updatedAt: string;
  failureCode: RunnerUpdateErrorCode | null;
}

export interface SafeInstalledReleaseSummary {
  product: string;
  version: string;
  sourceCommit: string;
  platform: string;
  architecture: string;
  installedAt: string;
}

export function summarizeRunnerUpdate(
  input: RunnerUpdateJournal,
): SafeRunnerUpdateSummary {
  const journal = RunnerUpdateJournalSchema.parse(input);
  return {
    updateId: journal.updateId,
    operation: journal.operation,
    state: journal.state,
    fromVersion: journal.fromVersion,
    targetVersion: journal.targetVersion,
    startedAt: journal.startedAt,
    updatedAt: journal.updatedAt,
    failureCode: journal.failureCode ?? null,
  };
}

export function summarizeInstalledRelease(
  input: InstalledReleaseRecord,
): SafeInstalledReleaseSummary {
  const release = InstalledReleaseRecordSchema.parse(input);
  return {
    product: release.product,
    version: release.version,
    sourceCommit: release.sourceCommit,
    platform: release.platform,
    architecture: release.architecture,
    installedAt: release.installedAt,
  };
}
