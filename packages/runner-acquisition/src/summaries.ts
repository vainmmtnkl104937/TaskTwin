import {
  CachedRunnerReleaseSchema,
  type CachedRunnerRelease,
} from './contracts.js';

export interface SafeCachedReleaseSummary {
  readonly releaseId: string;
  readonly version: string;
  readonly target: string;
  readonly verifiedAt: string;
}

export function summarizeCachedRelease(
  rawRecord: CachedRunnerRelease,
): SafeCachedReleaseSummary {
  const record = CachedRunnerReleaseSchema.parse(rawRecord);
  return {
    releaseId: record.releaseId,
    version: record.version,
    target: `${record.artifact.platform}/${record.artifact.architecture}`,
    verifiedAt: record.verifiedAt,
  };
}
