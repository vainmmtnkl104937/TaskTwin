import type { ReleaseManifest } from '@tasktwin/runner-release';
import type {
  RunnerReleaseCatalogStatus,
  RunnerReleaseStatusReason,
} from '@tasktwin/runner-rollout';

export interface RunnerReleaseRecord {
  id: string;
  product: string;
  version: string;
  manifestDigest: string;
  manifest: ReleaseManifest;
  signingKeyId: string;
  sourceCommit: string;
  builtAt: Date;
  status: RunnerReleaseCatalogStatus;
  statusReasonCode: RunnerReleaseStatusReason | null;
  importedByUserId: string;
  statusChangedByUserId: string | null;
  statusChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrustedRunnerReleaseImport {
  manifest: ReleaseManifest;
  manifestDigest: string;
}
