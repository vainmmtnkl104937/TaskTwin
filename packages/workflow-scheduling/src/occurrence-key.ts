import { createHash } from 'crypto';

/**
 * Build a deterministic SHA-256 occurrence key from a schedule ID and a UTC instant.
 *
 * The key is deterministic: the same (scheduleId, UTC second) pair always
 * produces the same key. This is used as the basis for the database unique
 * constraint on [scheduleId, scheduledFor], and for the human-readable display
 * of occurrence identity.
 *
 * Precise sub-millisecond values are ignored so that two timestamps that fall in
 * the same UTC second always produce the same key.
 *
 * @param scheduleId   – UUID of the WorkflowSchedule
 * @param scheduledInstant – UTC Date of the scheduled firing
 * @returns a 64-character lowercase hex string (SHA-256 digest)
 */
export function buildOccurrenceKey(
  scheduleId: string,
  scheduledInstant: Date,
): string {
  // Truncate to whole UTC seconds so sub-millisecond precision is collapsed.
  const seconds = Math.floor(scheduledInstant.getTime() / 1000);
  const canonical = new Date(seconds * 1000).toISOString();
  const payload = `${scheduleId}:${canonical}`;
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Verify that two occurrence keys match.
 */
export function occurrenceKeysMatch(a: string, b: string): boolean {
  return a === b;
}
