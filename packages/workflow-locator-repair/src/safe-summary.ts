import {
  SafeLocatorRepairCandidateSummarySchema,
  type RankedLocatorRepairCandidate,
  type SafeLocatorRepairCandidateSummary,
} from './contracts.js';

export function createSafeLocatorRepairCandidateSummary(
  input: RankedLocatorRepairCandidate & {
    id: string;
    rank: number;
    testStatus: SafeLocatorRepairCandidateSummary['testStatus'];
    testedAt: string | null;
  },
): SafeLocatorRepairCandidateSummary {
  return SafeLocatorRepairCandidateSummarySchema.parse({
    id: input.id,
    rank: input.rank,
    strategy: input.candidate.source,
    score: input.candidate.score,
    confidence: input.confidence,
    evidenceCodes: input.evidenceCodes,
    privacyClassification: input.privacyDecision.sensitivity,
    privacyRuleIds: input.privacyDecision.matchedRules,
    testStatus: input.testStatus,
    testedAt: input.testedAt,
  });
}
