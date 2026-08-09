import {
  RunnerSoftwareIdentitySchema,
  type RunnerSoftwareIdentity,
} from '@tasktwin/runner-release';
import { z } from 'zod';

import {
  RunnerActivationIdSchema,
  RunnerControlPlaneAcknowledgementSchema,
  RunnerStartupAttemptIdSchema,
  RunnerStartupStatusSchema,
  type RunnerControlPlaneAcknowledgement,
  type RunnerStartupStatus,
} from './contracts.js';

export const RunnerScmStateSchema = z.enum([
  'starting',
  'running',
  'stopped',
  'unknown',
]);

export const RunnerTargetHealthDecisionSchema = z.enum([
  'pending',
  'healthy',
  'unhealthy',
]);

export const RunnerTargetHealthReasonSchema = z.enum([
  'service_not_running',
  'service_executable_mismatch',
  'startup_status_missing',
  'startup_activation_mismatch',
  'startup_attempt_mismatch',
  'software_identity_mismatch',
  'startup_state_unhealthy',
  'claim_admission_open',
  'active_work_present',
  'component_checks_pending',
  'identity_check_failed',
  'instance_lock_check_failed',
  'workflow_engine_check_failed',
  'policy_runtime_check_failed',
  'chromium_check_failed',
  'local_secret_store_check_failed',
  'native_secret_auto_unlock_failed',
  'control_plane_rejected',
  'health_deadline_expired',
]);

export const RunnerTargetHealthInputSchema = z.strictObject({
  expectedActivationId: RunnerActivationIdSchema,
  expectedStartupAttemptId: RunnerStartupAttemptIdSchema,
  expectedSoftwareIdentity: RunnerSoftwareIdentitySchema,
  scmState: RunnerScmStateSchema,
  scmExecutableMatches: z.boolean(),
  startupStatus: RunnerStartupStatusSchema.nullable(),
  controlPlaneAcknowledgement: RunnerControlPlaneAcknowledgementSchema,
  deadlineExpired: z.boolean(),
  requireNativeSecretAutoUnlock: z.boolean(),
});

export const RunnerTargetHealthResultSchema = z.strictObject({
  decision: RunnerTargetHealthDecisionSchema,
  reasons: z.array(RunnerTargetHealthReasonSchema),
  observedVersion: RunnerSoftwareIdentitySchema.shape.version.nullable(),
});

export interface RunnerTargetHealthInput {
  expectedActivationId: string;
  expectedStartupAttemptId: string;
  expectedSoftwareIdentity: RunnerSoftwareIdentity;
  scmState: z.infer<typeof RunnerScmStateSchema>;
  scmExecutableMatches: boolean;
  startupStatus: RunnerStartupStatus | null;
  controlPlaneAcknowledgement: RunnerControlPlaneAcknowledgement;
  deadlineExpired: boolean;
  requireNativeSecretAutoUnlock: boolean;
}
export type RunnerTargetHealthDecision = z.infer<
  typeof RunnerTargetHealthDecisionSchema
>;
export type RunnerTargetHealthReason = z.infer<
  typeof RunnerTargetHealthReasonSchema
>;
export type RunnerTargetHealthResult = z.infer<
  typeof RunnerTargetHealthResultSchema
>;

function softwareIdentityMatches(
  expected: RunnerSoftwareIdentity,
  observed: RunnerSoftwareIdentity,
): boolean {
  return (
    expected.product === observed.product &&
    expected.version === observed.version &&
    expected.runnerProtocolVersion === observed.runnerProtocolVersion &&
    expected.workflowSchemaVersion === observed.workflowSchemaVersion &&
    expected.localStateSchemaVersion === observed.localStateSchemaVersion &&
    expected.platform === observed.platform &&
    expected.architecture === observed.architecture
  );
}

function controlPlaneRejects(
  status: RunnerControlPlaneAcknowledgement,
): boolean {
  return status === 'update_required' || status === 'unsupported';
}

/**
 * Evaluates local startup health. A missing or offline Control Plane is not a
 * local-health failure, while an explicit incompatible acknowledgement is.
 */
export function evaluateTargetHealth(
  rawInput: RunnerTargetHealthInput,
): RunnerTargetHealthResult {
  const input = RunnerTargetHealthInputSchema.parse(rawInput);
  const hardReasons: RunnerTargetHealthReason[] = [];
  let isPending = false;

  if (input.scmState !== 'running') {
    if (input.scmState === 'starting' || input.scmState === 'unknown') {
      isPending = true;
    } else {
      hardReasons.push('service_not_running');
    }
  }
  if (!input.scmExecutableMatches) {
    if (input.scmState === 'running') {
      hardReasons.push('service_executable_mismatch');
    } else {
      isPending = true;
    }
  }

  const status = input.startupStatus;
  if (status === null) {
    isPending = true;
    hardReasons.push('startup_status_missing');
  } else {
    if (status.activationId !== input.expectedActivationId) {
      hardReasons.push('startup_activation_mismatch');
    }
    if (status.startupAttemptId !== input.expectedStartupAttemptId) {
      hardReasons.push('startup_attempt_mismatch');
    }
    if (
      !softwareIdentityMatches(
        input.expectedSoftwareIdentity,
        status.softwareIdentity,
      )
    ) {
      hardReasons.push('software_identity_mismatch');
    }
    if (status.state === 'starting') isPending = true;
    if (
      status.state === 'failed' ||
      status.state === 'stopped' ||
      status.state === 'draining'
    ) {
      hardReasons.push('startup_state_unhealthy');
    }
    if (status.acceptsNewJobs) hardReasons.push('claim_admission_open');
    if (status.activeWork) hardReasons.push('active_work_present');

    const checkReasons = [
      ['identity', 'identity_check_failed'],
      ['instanceLock', 'instance_lock_check_failed'],
      ['workflowEngine', 'workflow_engine_check_failed'],
      ['policyRuntime', 'policy_runtime_check_failed'],
      ['chromium', 'chromium_check_failed'],
      ['localSecretStore', 'local_secret_store_check_failed'],
    ] as const;
    checkReasons.forEach(([check, failureReason]) => {
      if (status.checks[check] === 'pending') isPending = true;
      if (status.checks[check] === 'failed') hardReasons.push(failureReason);
    });
    if (
      status.checks.nativeSecretAutoUnlock === 'pending' ||
      (input.requireNativeSecretAutoUnlock &&
        status.checks.nativeSecretAutoUnlock === 'not_required')
    ) {
      isPending = true;
    }
    if (status.checks.nativeSecretAutoUnlock === 'failed') {
      hardReasons.push('native_secret_auto_unlock_failed');
    }
    if (
      input.requireNativeSecretAutoUnlock &&
      status.checks.nativeSecretAutoUnlock === 'not_required'
    ) {
      hardReasons.push('native_secret_auto_unlock_failed');
    }
    if (controlPlaneRejects(status.controlPlaneAcknowledgement)) {
      hardReasons.push('control_plane_rejected');
    }
  }

  if (controlPlaneRejects(input.controlPlaneAcknowledgement)) {
    hardReasons.push('control_plane_rejected');
  }

  if (isPending && !hardReasons.includes('startup_status_missing')) {
    hardReasons.push('component_checks_pending');
  }

  if (isPending && input.deadlineExpired) {
    hardReasons.push('health_deadline_expired');
  }

  const uniqueReasons = [...new Set(hardReasons)];
  const hasOnlyPendingReasons = uniqueReasons.every(
    (reason) =>
      reason === 'startup_status_missing' ||
      reason === 'component_checks_pending',
  );
  const decision: RunnerTargetHealthDecision =
    isPending && !input.deadlineExpired && hasOnlyPendingReasons
      ? 'pending'
      : uniqueReasons.length === 0 && status?.state === 'healthy'
        ? 'healthy'
        : 'unhealthy';

  return RunnerTargetHealthResultSchema.parse({
    decision,
    reasons: uniqueReasons,
    observedVersion: status?.softwareIdentity.version ?? null,
  });
}
