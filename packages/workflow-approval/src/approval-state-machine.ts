import type { ApprovalRequestStatus } from './contracts.js';

const TRANSITIONS = {
  PENDING: ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'INVALIDATED'],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
  INVALIDATED: [],
} as const satisfies Record<
  ApprovalRequestStatus,
  readonly ApprovalRequestStatus[]
>;

export function canTransitionApprovalRequest(
  current: ApprovalRequestStatus,
  next: ApprovalRequestStatus,
): boolean {
  return (TRANSITIONS[current] as readonly ApprovalRequestStatus[]).includes(
    next,
  );
}

export function isTerminalApprovalRequestStatus(
  status: ApprovalRequestStatus,
): boolean {
  return status !== 'PENDING';
}
