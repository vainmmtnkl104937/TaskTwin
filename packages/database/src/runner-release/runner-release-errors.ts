export const RUNNER_RELEASE_REPOSITORY_ERROR_CODES = [
  'RELEASE_NOT_FOUND',
  'RELEASE_VERSION_CONFLICT',
  'RELEASE_IMPORT_CONFLICT',
  'RELEASE_STATUS_CONFLICT',
  'SYSTEM_ADMIN_REQUIRED',
] as const;

export type RunnerReleaseRepositoryErrorCode =
  (typeof RUNNER_RELEASE_REPOSITORY_ERROR_CODES)[number];

export class RunnerReleaseRepositoryError extends Error {
  constructor(readonly code: RunnerReleaseRepositoryErrorCode) {
    super(code);
    this.name = 'RunnerReleaseRepositoryError';
  }
}
