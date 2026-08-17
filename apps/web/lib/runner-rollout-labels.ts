const RELEASE_STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  deprecated: 'Deprecated',
  blocked: 'Blocked',
};

const RELEASE_STATUS_REASON_LABEL: Record<string, string> = {
  superseded: 'Superseded by newer release',
  end_of_support: 'End of support',
  security_issue: 'Security issue',
  integrity_issue: 'Integrity issue (signature or manifest mismatch)',
  compatibility_issue: 'Compatibility issue',
  operational_issue: 'Operational issue',
};

const COMPLIANCE_LABEL: Record<string, string> = {
  compliant: 'Compliant with fleet desired version',
  update_available: 'Update available (optional)',
  update_required: 'Update required',
  updating_external: 'Updating externally',
  rolled_back: 'Rolled back to a previous release',
  unsupported: 'Unsupported release',
  unknown: 'Status unknown',
};

const ROLLOUT_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const ROLLOUT_STAGE_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  active: 'Active',
  completed: 'Converged',
  failed_review: 'Review required',
  cancelled: 'Cancelled',
};

const ROLLOUT_ASSIGNMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  target_assigned: 'Target assigned to a stage',
  converged: 'Converged to target release',
  rolled_back: 'Rolled back to baseline',
  failed: 'Failed review',
  cancelled: 'Cancelled',
};

const ROLLOUT_REVIEW_REASON_LABEL: Record<string, string> = {
  unknown_baseline: 'Baseline Runner version is unknown',
  superseded_baseline: 'Baseline Runner version is superseded',
  unsupported_baseline: 'Baseline Runner version is unsupported',
  integrity_baseline: 'Baseline Runner identity fails integrity check',
  compatibility_baseline: 'Baseline Runner fails compatibility check',
  no_active_runners: 'No Runner is currently active in this rollout',
  pause_requested: 'Pause was requested',
  cancel_requested: 'Cancellation was requested',
  integrity_observed: 'Observed Runner identity fails integrity check',
  compatibility_observed: 'Observed Runner fails compatibility check',
  end_of_life_target: 'Target release is no longer supported',
  no_target_release: 'Target release is not in the trusted catalog',
  blocked_target: 'Target release is blocked from rollouts',
};

export function describeReleaseStatus(
  status: string,
  reasonCode: string | null,
): string {
  const base = RELEASE_STATUS_LABEL[status] ?? status;
  if (reasonCode === null) return base;
  const reason = RELEASE_STATUS_REASON_LABEL[reasonCode] ?? reasonCode;
  return `${base} (${reason})`;
}

export function describeCompliance(status: string): string {
  return COMPLIANCE_LABEL[status] ?? status;
}

export function describeRolloutStatus(status: string): string {
  return ROLLOUT_STATUS_LABEL[status] ?? status;
}

export function describeRolloutStageStatus(status: string): string {
  return ROLLOUT_STAGE_STATUS_LABEL[status] ?? status;
}

export function describeRolloutAssignmentStatus(status: string): string {
  return ROLLOUT_ASSIGNMENT_STATUS_LABEL[status] ?? status;
}

export function describeRolloutReviewReason(reason: string | null): string {
  if (reason === null) return '—';
  return ROLLOUT_REVIEW_REASON_LABEL[reason] ?? reason;
}