import type {
  RunInputPreparationMetadata,
  RunnerPublicKeyMetadata,
} from '@tasktwin/secure-run-inputs';

export interface RunnerEncryptionKeyRegistrationResult {
  key: RunnerPublicKeyMetadata;
  idempotent: boolean;
}

export interface RunInputPreparationResult {
  preparation: RunInputPreparationMetadata;
  idempotent: boolean;
}

export interface RunInputCommitResult {
  workflowRunId: string;
  idempotent: boolean;
}
