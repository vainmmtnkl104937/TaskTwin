import {
  ComplianceInputSchema,
  type ComplianceInput,
  type RunnerComplianceStatus,
} from './contracts.js';

export function deriveRunnerCompliance(
  unparsedInput: ComplianceInput,
): RunnerComplianceStatus {
  const input = ComplianceInputSchema.parse(unparsedInput);
  if (input.actualIdentity === null) return 'unknown';
  if (input.actualReleaseStatus === 'blocked') return 'unsupported';
  if (input.compatibility.status === 'unsupported') return 'unsupported';
  if (input.assignmentStatus === 'rolled_back') return 'rolled_back';
  if (
    input.assignmentStatus === 'target_assigned' &&
    input.localMaintenanceObserved
  ) {
    return 'updating_external';
  }
  if (input.compatibility.status === 'update_required') {
    return 'update_required';
  }
  if (
    input.desiredVersion !== null &&
    input.actualIdentity.version !== input.desiredVersion
  ) {
    return 'update_available';
  }
  if (input.compatibility.status === 'update_recommended') {
    return 'update_available';
  }
  if (input.actualReleaseStatus === null && input.desiredVersion === null) {
    return 'unknown';
  }
  return 'compliant';
}

export function runnerComplianceAllowsClaims(
  status: RunnerComplianceStatus,
): boolean {
  return (
    status === 'compliant' ||
    status === 'update_available' ||
    status === 'unknown'
  );
}
