import {
  calculateLocatorConfidence,
  canonicalizeLocator,
  rankLocatorBundle,
} from '@tasktwin/locator-engine';

import {
  LocatorRepairCandidateInputListSchema,
  RankedLocatorRepairCandidateListSchema,
  type LocatorRepairCandidateInput,
  type RankedLocatorRepairCandidate,
} from './contracts.js';
import { isLocatorCandidatePrivacyEligible } from './privacy-eligibility.js';

export function rankLocatorRepairCandidates(
  inputs: readonly LocatorRepairCandidateInput[],
  generatedAt: string,
): RankedLocatorRepairCandidate[] {
  const parsed = LocatorRepairCandidateInputListSchema.parse(inputs);
  const eligible = parsed.filter((input) =>
    isLocatorCandidatePrivacyEligible({
      locator: input.observation.locator,
      privacyInput: input.privacyInput,
      privacyDecision: input.privacyDecision,
    }),
  );
  const ranked = rankLocatorBundle(
    eligible.map((input) => input.observation),
    generatedAt,
  );
  if (!ranked.success) return [];
  const candidates = [ranked.bundle.primary, ...ranked.bundle.fallbacks];
  const byLocator = new Map(
    eligible.map((input) => [
      canonicalizeLocator(input.observation.locator),
      input,
    ]),
  );
  return RankedLocatorRepairCandidateListSchema.parse(
    candidates.flatMap((candidate, index) => {
      const source = byLocator.get(canonicalizeLocator(candidate.locator));
      if (source === undefined) return [];
      return [
        {
          candidate,
          confidence: calculateLocatorConfidence(
            candidate,
            candidates.slice(index + 1),
          ),
          elementKind: source.elementKind,
          evidenceCodes: [...new Set(source.evidenceCodes)],
          privacyDecision: source.privacyDecision,
        },
      ];
    }),
  );
}
