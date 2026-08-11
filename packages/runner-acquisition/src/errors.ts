export const RUNNER_ACQUISITION_ERROR_CODES = [
  'acquisition_input_invalid',
  'acquisition_source_untrusted',
  'acquisition_url_invalid',
  'acquisition_redirect_rejected',
  'acquisition_reference_mismatch',
  'acquisition_target_unsupported',
  'acquisition_connect_timeout',
  'acquisition_read_timeout',
  'acquisition_request_timeout',
  'acquisition_response_invalid',
  'acquisition_metadata_too_large',
  'acquisition_artifact_too_large',
  'acquisition_partial_invalid',
  'acquisition_range_invalid',
  'acquisition_remote_identity_changed',
  'acquisition_cache_conflict',
  'acquisition_cache_invalid',
  'acquisition_promotion_failed',
] as const;

export type RunnerAcquisitionErrorCode =
  (typeof RUNNER_ACQUISITION_ERROR_CODES)[number];

export class RunnerAcquisitionError extends Error {
  readonly code: RunnerAcquisitionErrorCode;

  constructor(code: RunnerAcquisitionErrorCode, message: string) {
    super(message);
    this.name = 'RunnerAcquisitionError';
    this.code = code;
  }
}
