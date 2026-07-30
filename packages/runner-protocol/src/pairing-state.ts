import type { PairingStatus } from './contracts.js';

const VALID_TRANSITIONS = new Set<string>([
  'PENDING:APPROVED',
  'PENDING:DENIED',
  'PENDING:EXPIRED',
  'APPROVED:CONSUMED',
  'APPROVED:EXPIRED',
]);

export interface PairingTransitionResult {
  ok: boolean;
  from: PairingStatus;
  to: PairingStatus;
}

export function canTransitionPairingStatus(
  from: PairingStatus,
  to: PairingStatus,
): boolean {
  return VALID_TRANSITIONS.has(`${from}:${to}`);
}

export function validatePairingStatusTransition(
  from: PairingStatus,
  to: PairingStatus,
): PairingTransitionResult {
  return {
    ok: canTransitionPairingStatus(from, to),
    from,
    to,
  };
}

export function deriveRunnerConnectionStatus(input: {
  lastSeenAt: string | null;
  revokedAt: string | null;
  now: string;
  offlineAfterSeconds: number;
}): 'online' | 'offline' | 'revoked' {
  if (input.revokedAt !== null) {
    return 'revoked';
  }
  if (input.lastSeenAt === null) {
    return 'offline';
  }
  const lastSeenAt = Date.parse(input.lastSeenAt);
  const now = Date.parse(input.now);
  if (
    !Number.isFinite(lastSeenAt) ||
    !Number.isFinite(now) ||
    input.offlineAfterSeconds <= 0
  ) {
    return 'offline';
  }
  return now - lastSeenAt <= input.offlineAfterSeconds * 1_000
    ? 'online'
    : 'offline';
}
