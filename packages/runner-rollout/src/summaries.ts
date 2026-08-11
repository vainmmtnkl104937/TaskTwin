import type {
  RunnerComplianceStatus,
  RunnerRolloutAssignmentStatus,
} from './contracts.js';

export function summarizeAssignments(
  statuses: readonly RunnerRolloutAssignmentStatus[],
) {
  return {
    total: statuses.length,
    pending: statuses.filter((status) => status === 'pending').length,
    targetAssigned: statuses.filter((status) => status === 'target_assigned')
      .length,
    converged: statuses.filter((status) => status === 'converged').length,
    rolledBack: statuses.filter((status) => status === 'rolled_back').length,
    failed: statuses.filter((status) => status === 'failed').length,
    cancelled: statuses.filter((status) => status === 'cancelled').length,
  };
}

export function summarizeCompliance(
  statuses: readonly RunnerComplianceStatus[],
) {
  return {
    compliant: statuses.filter((status) => status === 'compliant').length,
    updateAvailable: statuses.filter((status) => status === 'update_available')
      .length,
    updateRequired: statuses.filter((status) => status === 'update_required')
      .length,
    unsupported: statuses.filter((status) => status === 'unsupported').length,
  };
}
