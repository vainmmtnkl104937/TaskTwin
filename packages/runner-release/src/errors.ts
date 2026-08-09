export const RUNNER_RELEASE_ERROR_CODES = [
  'release_manifest_invalid',
  'release_signature_invalid',
  'release_signing_key_unknown',
  'release_signing_key_mismatch',
  'release_manifest_digest_mismatch',
  'release_signature_verification_failed',
  'release_artifact_not_declared',
  'release_artifact_name_mismatch',
  'release_artifact_size_mismatch',
  'release_artifact_hash_mismatch',
  'release_target_unsupported',
  'release_state_unsupported',
  'release_migration_required',
  'release_downgrade_blocked',
] as const;

export type RunnerReleaseErrorCode =
  (typeof RUNNER_RELEASE_ERROR_CODES)[number];

export class RunnerReleaseError extends Error {
  readonly code: RunnerReleaseErrorCode;

  constructor(code: RunnerReleaseErrorCode, message: string) {
    super(message);
    this.name = 'RunnerReleaseError';
    this.code = code;
  }
}
