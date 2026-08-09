import {
  ControlPlaneRunnerCompatibilityPolicySchema,
  LOCAL_RUNNER_STATE_SCHEMA_VERSION,
  RUNNER_RELEASE_PRODUCT,
  RunnerSoftwareIdentitySchema,
  evaluateRunnerCompatibility,
  type ControlPlaneRunnerCompatibilityPolicy,
  type RunnerSoftwareIdentity,
} from '@tasktwin/runner-release';
import { RUN_PROTOCOL_VERSION } from '@tasktwin/run-protocol';
import { WORKFLOW_SCHEMA_VERSION } from '@tasktwin/workflow-schema';

export const CONTROL_PLANE_RUNNER_COMPATIBILITY_POLICY =
  ControlPlaneRunnerCompatibilityPolicySchema.parse({
    product: RUNNER_RELEASE_PRODUCT,
    supportedPlatforms: ['windows', 'macos', 'linux'],
    supportedArchitectures: ['x64', 'arm64'],
    supportedRunnerProtocolVersions: [RUN_PROTOCOL_VERSION],
    supportedWorkflowSchemaVersions: [WORKFLOW_SCHEMA_VERSION],
    supportedLocalStateSchemaVersions: [LOCAL_RUNNER_STATE_SCHEMA_VERSION],
    minimumVersion: '0.1.0',
    recommendedVersion: '0.1.0',
  });

export interface PersistedRunnerSoftwareFields {
  runnerVersion: string;
  platform: string;
  architecture: string;
  runProtocolVersion: number | null;
  workflowSchemaVersion: number | null;
  localStateSchemaVersion: number | null;
}

export function toRunnerReleasePlatform(
  platform: string,
): RunnerSoftwareIdentity['platform'] | null {
  switch (platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    default:
      return null;
  }
}

export function toPersistedRunnerSoftwareIdentity(
  runner: PersistedRunnerSoftwareFields,
): RunnerSoftwareIdentity | null {
  if (
    runner.runProtocolVersion === null ||
    runner.workflowSchemaVersion === null ||
    runner.localStateSchemaVersion === null
  ) {
    return null;
  }

  const parsed = RunnerSoftwareIdentitySchema.safeParse({
    product: RUNNER_RELEASE_PRODUCT,
    version: runner.runnerVersion,
    platform: toRunnerReleasePlatform(runner.platform),
    architecture: runner.architecture,
    runnerProtocolVersion: runner.runProtocolVersion,
    workflowSchemaVersion: runner.workflowSchemaVersion,
    localStateSchemaVersion: runner.localStateSchemaVersion,
  });
  return parsed.success ? parsed.data : null;
}

export function evaluatePersistedRunnerCompatibility(
  runner: PersistedRunnerSoftwareFields,
  policy: ControlPlaneRunnerCompatibilityPolicy = CONTROL_PLANE_RUNNER_COMPATIBILITY_POLICY,
): ReturnType<typeof evaluateRunnerCompatibility> {
  return evaluateRunnerCompatibility({
    identity: toPersistedRunnerSoftwareIdentity(runner),
    policy,
  });
}

export function canRunnerClaimJobs(
  decision: ReturnType<typeof evaluateRunnerCompatibility>,
): boolean {
  return (
    decision.status === 'compatible' || decision.status === 'update_recommended'
  );
}
