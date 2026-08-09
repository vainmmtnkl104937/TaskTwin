import { z } from 'zod';

export const RUNNER_UPDATE_ERROR_CODES = [
  'update_input_invalid',
  'update_id_invalid',
  'update_state_transition_invalid',
  'update_already_in_progress',
  'update_current_release_unverified',
  'update_target_release_unverified',
  'update_target_version_not_newer',
  'update_forward_compatibility_failed',
  'update_migration_required',
  'update_rollback_unproven',
  'update_lease_failed',
  'update_drain_timeout',
  'update_archive_unsafe',
  'update_staging_failed',
  'update_journal_invalid',
  'update_journal_write_failed',
  'update_service_switch_failed',
  'update_target_health_failed',
  'update_previous_release_unverified',
  'update_rollback_compatibility_failed',
  'update_rollback_failed',
  'update_recovery_ambiguous',
  'update_manual_recovery_required',
  'update_retention_invalid',
] as const;

export const RunnerUpdateErrorCodeSchema = z.enum(RUNNER_UPDATE_ERROR_CODES);

export type RunnerUpdateErrorCode = z.infer<typeof RunnerUpdateErrorCodeSchema>;

export class RunnerUpdateError extends Error {
  readonly code: RunnerUpdateErrorCode;

  constructor(code: RunnerUpdateErrorCode, message: string) {
    super(message);
    this.name = 'RunnerUpdateError';
    this.code = code;
  }
}
