import { LOCATOR_SOURCE_PRIORITY, MAX_LOCATOR_FALLBACKS } from './constants.js';
import {
  LocatorBundleSchema,
  LocatorObservationListSchema,
  type LocatorBundle,
  type LocatorObservation,
} from './contracts.js';
import { canonicalizeLocator } from './canonical-locator.js';
import { calculateLocatorConfidence } from './confidence.js';
import { scoreLocatorObservation, type ScoredLocator } from './scoring.js';

export type RankLocatorBundleResult =
  | { success: true; bundle: LocatorBundle }
  | { success: false; reason: 'no-unique-locator' };

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function compareScoredLocators(
  left: ScoredLocator,
  right: ScoredLocator,
): number {
  if (left.candidate.score !== right.candidate.score) {
    return right.candidate.score - left.candidate.score;
  }

  const sourceDifference =
    LOCATOR_SOURCE_PRIORITY[left.candidate.source] -
    LOCATOR_SOURCE_PRIORITY[right.candidate.source];
  if (sourceDifference !== 0) {
    return sourceDifference;
  }

  if (left.canonicalRiskCount !== right.canonicalRiskCount) {
    return left.canonicalRiskCount - right.canonicalRiskCount;
  }

  const leftKey = canonicalizeLocator(left.candidate.locator);
  const rightKey = canonicalizeLocator(right.candidate.locator);
  if (leftKey.length !== rightKey.length) {
    return leftKey.length - rightKey.length;
  }
  return compareStrings(leftKey, rightKey);
}

export function rankLocatorBundle(
  observations: readonly LocatorObservation[],
  generatedAt: string,
): RankLocatorBundleResult {
  const parsedObservations = LocatorObservationListSchema.parse(observations);
  const deduplicated = new Map<string, ScoredLocator>();

  for (const observation of parsedObservations) {
    const scored = scoreLocatorObservation(observation);
    if (scored === null) {
      continue;
    }

    const key = canonicalizeLocator(scored.candidate.locator);
    const existing = deduplicated.get(key);
    if (existing === undefined || compareScoredLocators(scored, existing) < 0) {
      deduplicated.set(key, scored);
    }
  }

  const ranked = [...deduplicated.values()].sort(compareScoredLocators);
  const primary = ranked[0]?.candidate;
  if (primary === undefined) {
    return { success: false, reason: 'no-unique-locator' };
  }

  const fallbacks = ranked
    .slice(1, MAX_LOCATOR_FALLBACKS + 1)
    .map((entry) => entry.candidate);

  return {
    success: true,
    bundle: LocatorBundleSchema.parse({
      schemaVersion: 1,
      primary,
      fallbacks,
      confidence: calculateLocatorConfidence(primary, fallbacks),
      generatedAt,
    }),
  };
}
