import { z } from 'zod';

import {
  DEFAULT_RETAINED_RUNNER_RELEASES,
  MAX_RETAINED_RUNNER_RELEASES,
} from './constants.js';
import {
  ActiveReleaseRecordSchema,
  InstalledReleaseRecordSchema,
  RunnerReleaseIdSchema,
  RunnerUpdateJournalSchema,
  type ActiveReleaseRecord,
  type InstalledReleaseRecord,
  type RunnerReleaseId,
  type RunnerUpdateJournal,
} from './contracts.js';
import { RunnerUpdateError } from './errors.js';

export const RunnerReleaseRetentionInputSchema = z.strictObject({
  installedReleases: z.array(InstalledReleaseRecordSchema),
  activeRelease: ActiveReleaseRecordSchema,
  journal: RunnerUpdateJournalSchema.nullable(),
  maxRetainedReleases: z
    .number()
    .int()
    .min(DEFAULT_RETAINED_RUNNER_RELEASES)
    .max(MAX_RETAINED_RUNNER_RELEASES)
    .optional(),
});

export const RunnerReleaseRetentionDecisionSchema = z.strictObject({
  keepReleaseIds: z.array(RunnerReleaseIdSchema),
  removeReleaseIds: z.array(RunnerReleaseIdSchema),
});

export interface RunnerReleaseRetentionInput {
  installedReleases: InstalledReleaseRecord[];
  activeRelease: ActiveReleaseRecord;
  journal: RunnerUpdateJournal | null;
  maxRetainedReleases?: number;
}
export type RunnerReleaseRetentionDecision = z.infer<
  typeof RunnerReleaseRetentionDecisionSchema
>;

const NONTERMINAL_STATES = new Set<RunnerUpdateJournal['state']>([
  'preparing',
  'draining',
  'staging',
  'ready_to_switch',
  'switching',
  'starting_target',
  'verifying_target',
  'rolling_back',
]);

/**
 * Selects retention candidates only. The application boundary remains
 * responsible for path containment, link rejection, and deletion.
 */
export function decideReleaseRetention(
  rawInput: RunnerReleaseRetentionInput,
): RunnerReleaseRetentionDecision {
  const input = RunnerReleaseRetentionInputSchema.parse(rawInput);
  const maxRetained =
    input.maxRetainedReleases ?? DEFAULT_RETAINED_RUNNER_RELEASES;
  const releaseById = new Map<RunnerReleaseId, InstalledReleaseRecord>();
  input.installedReleases.forEach((release) => {
    if (releaseById.has(release.releaseId)) {
      throw new RunnerUpdateError(
        'update_retention_invalid',
        'Installed release records must have unique release IDs.',
      );
    }
    releaseById.set(release.releaseId, release);
  });

  if (!releaseById.has(input.activeRelease.currentReleaseId)) {
    throw new RunnerUpdateError(
      'update_retention_invalid',
      'The active release is not present in installed releases.',
    );
  }
  if (
    input.activeRelease.previousReleaseId !== null &&
    !releaseById.has(input.activeRelease.previousReleaseId)
  ) {
    throw new RunnerUpdateError(
      'update_retention_invalid',
      'The previous release is not present in installed releases.',
    );
  }

  if (input.journal?.state === 'manual_recovery_required') {
    return {
      keepReleaseIds: input.installedReleases
        .map((release) => release.releaseId)
        .sort(),
      removeReleaseIds: [],
    };
  }

  const mandatory = new Set<RunnerReleaseId>([
    input.activeRelease.currentReleaseId,
  ]);
  if (input.activeRelease.previousReleaseId !== null) {
    mandatory.add(input.activeRelease.previousReleaseId);
  }
  if (input.journal !== null && NONTERMINAL_STATES.has(input.journal.state)) {
    mandatory.add(input.journal.sourceReleaseId);
    mandatory.add(input.journal.targetReleaseId);
  }

  const newestFirst = [...input.installedReleases].sort((left, right) => {
    const byTime = right.installedAt.localeCompare(left.installedAt);
    return byTime !== 0
      ? byTime
      : left.releaseId.localeCompare(right.releaseId);
  });
  const keep = new Set(mandatory);
  newestFirst.forEach((release) => {
    if (keep.size < maxRetained) keep.add(release.releaseId);
  });

  return RunnerReleaseRetentionDecisionSchema.parse({
    keepReleaseIds: input.installedReleases
      .map((release) => release.releaseId)
      .filter((releaseId) => keep.has(releaseId))
      .sort(),
    removeReleaseIds: input.installedReleases
      .map((release) => release.releaseId)
      .filter((releaseId) => !keep.has(releaseId))
      .sort(),
  });
}
