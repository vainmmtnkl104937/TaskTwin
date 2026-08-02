import type { RepairRequestStatus } from './contracts.js';

const TRANSITIONS = {
  PENDING: ['RETRY_APPROVED', 'ABORTED', 'EXPIRED', 'CANCELLED', 'INVALIDATED'],
  RETRY_APPROVED: [],
  ABORTED: [],
  EXPIRED: [],
  CANCELLED: [],
  INVALIDATED: [],
} as const satisfies Record<
  RepairRequestStatus,
  readonly RepairRequestStatus[]
>;

export function canTransitionRepairRequest(
  current: RepairRequestStatus,
  next: RepairRequestStatus,
): boolean {
  return (TRANSITIONS[current] as readonly RepairRequestStatus[]).includes(
    next,
  );
}

export function isTerminalRepairRequestStatus(
  status: RepairRequestStatus,
): boolean {
  return TRANSITIONS[status].length === 0;
}
