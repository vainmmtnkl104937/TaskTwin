import { z } from 'zod';

import {
  RunnerUpdateJournalSchema,
  RunnerUpdateStateSchema,
  type RunnerUpdateJournal,
} from './contracts.js';

export const RunnerObservedServiceReleaseSchema = z.enum([
  'source',
  'target',
  'neither',
  'ambiguous',
]);

export const RunnerObservedHealthSchema = z.enum([
  'pending',
  'healthy',
  'unhealthy',
]);

export const RunnerRollbackSafetySchema = z.enum(['safe', 'unsafe', 'unknown']);

export const RunnerCrashRecoveryActionSchema = z.enum([
  'no_action',
  'fail_before_switch',
  'resume_target_verification',
  'complete_target',
  'begin_rollback',
  'retry_rollback',
  'complete_rollback',
  'manual_recovery',
]);

export const RunnerCrashRecoveryReasonSchema = z.enum([
  'no_update_journal',
  'update_already_terminal',
  'source_intact_before_switch',
  'target_health_pending',
  'target_is_healthy',
  'target_is_unhealthy',
  'source_is_healthy',
  'rollback_must_continue',
  'rollback_safety_unproven',
  'installation_state_ambiguous',
]);

export const RunnerCrashRecoveryInputSchema = z.strictObject({
  journal: RunnerUpdateJournalSchema.nullable(),
  observedServiceRelease: RunnerObservedServiceReleaseSchema,
  targetHealth: RunnerObservedHealthSchema,
  sourceHealth: RunnerObservedHealthSchema,
  rollbackSafety: RunnerRollbackSafetySchema,
});

export const RunnerCrashRecoveryDecisionSchema = z.strictObject({
  action: RunnerCrashRecoveryActionSchema,
  reason: RunnerCrashRecoveryReasonSchema,
  nextState: RunnerUpdateStateSchema.nullable(),
});

export interface RunnerCrashRecoveryInput {
  journal: RunnerUpdateJournal | null;
  observedServiceRelease: z.infer<typeof RunnerObservedServiceReleaseSchema>;
  targetHealth: z.infer<typeof RunnerObservedHealthSchema>;
  sourceHealth: z.infer<typeof RunnerObservedHealthSchema>;
  rollbackSafety: z.infer<typeof RunnerRollbackSafetySchema>;
}
export type RunnerCrashRecoveryAction = z.infer<
  typeof RunnerCrashRecoveryActionSchema
>;
export type RunnerCrashRecoveryReason = z.infer<
  typeof RunnerCrashRecoveryReasonSchema
>;
export type RunnerCrashRecoveryDecision = z.infer<
  typeof RunnerCrashRecoveryDecisionSchema
>;

const PRE_SWITCH_STATES = new Set<RunnerUpdateJournal['state']>([
  'preparing',
  'draining',
  'staging',
  'ready_to_switch',
]);
const TARGET_START_STATES = new Set<RunnerUpdateJournal['state']>([
  'switching',
  'starting_target',
  'verifying_target',
]);
const TERMINAL_STATES = new Set<RunnerUpdateJournal['state']>([
  'idle',
  'succeeded',
  'failed_before_switch',
  'rolled_back',
  'manual_recovery_required',
]);

function decision(
  action: RunnerCrashRecoveryAction,
  reason: RunnerCrashRecoveryReason,
  nextState: RunnerUpdateJournal['state'] | null,
): RunnerCrashRecoveryDecision {
  return RunnerCrashRecoveryDecisionSchema.parse({
    action,
    reason,
    nextState,
  });
}

function manualRecovery(
  reason: 'rollback_safety_unproven' | 'installation_state_ambiguous',
): RunnerCrashRecoveryDecision {
  return decision('manual_recovery', reason, 'manual_recovery_required');
}

/** Chooses a recovery action without mutating the installation. */
export function decideCrashRecovery(
  rawInput: RunnerCrashRecoveryInput,
): RunnerCrashRecoveryDecision {
  const input = RunnerCrashRecoveryInputSchema.parse(rawInput);
  const { journal } = input;
  if (journal === null) {
    return decision('no_action', 'no_update_journal', null);
  }
  if (TERMINAL_STATES.has(journal.state)) {
    return decision('no_action', 'update_already_terminal', null);
  }

  if (PRE_SWITCH_STATES.has(journal.state)) {
    return input.observedServiceRelease === 'source'
      ? decision(
          'fail_before_switch',
          'source_intact_before_switch',
          'failed_before_switch',
        )
      : manualRecovery('installation_state_ambiguous');
  }

  if (TARGET_START_STATES.has(journal.state)) {
    if (
      journal.state === 'switching' &&
      input.observedServiceRelease === 'source'
    ) {
      return decision(
        'fail_before_switch',
        'source_intact_before_switch',
        'failed_before_switch',
      );
    }
    if (input.observedServiceRelease !== 'target') {
      return manualRecovery('installation_state_ambiguous');
    }
    if (input.rollbackSafety !== 'safe') {
      return manualRecovery('rollback_safety_unproven');
    }
    if (input.targetHealth === 'pending') {
      return decision(
        'resume_target_verification',
        'target_health_pending',
        'verifying_target',
      );
    }
    if (input.targetHealth === 'healthy') {
      return decision('complete_target', 'target_is_healthy', 'succeeded');
    }
    return decision('begin_rollback', 'target_is_unhealthy', 'rolling_back');
  }

  if (journal.state === 'rolling_back') {
    if (input.rollbackSafety !== 'safe') {
      return manualRecovery('rollback_safety_unproven');
    }
    if (
      input.observedServiceRelease === 'source' &&
      input.sourceHealth === 'healthy'
    ) {
      return decision('complete_rollback', 'source_is_healthy', 'rolled_back');
    }
    if (input.observedServiceRelease === 'target') {
      return decision(
        'retry_rollback',
        'rollback_must_continue',
        'rolling_back',
      );
    }
    return manualRecovery('installation_state_ambiguous');
  }

  return manualRecovery('installation_state_ambiguous');
}
