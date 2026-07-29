import { LOCATOR_BASE_SCORES, LOCATOR_SCORE_ADJUSTMENTS } from './constants.js';
import {
  LOCATOR_REASON_MESSAGES,
  type LocatorCandidate,
  type LocatorObservation,
  type LocatorReason,
  type LocatorReasonCode,
} from './contracts.js';
import {
  cssUsesPosition,
  detectIdentifierRisks,
  getCssDepth,
  looksLikeGeneratedClass,
  type IdentifierRisk,
} from './identifier-heuristics.js';
import { isLikelySensitiveText } from './text-heuristics.js';

const SOURCE_REASON_CODES = {
  testId: 'STRONG_TEST_ID',
  role: 'ACCESSIBLE_ROLE',
  label: 'ASSOCIATED_LABEL',
  stableId: 'STABLE_ID',
  placeholder: 'PLACEHOLDER',
  stableName: 'STABLE_NAME',
  text: 'UNIQUE_TEXT',
  css: 'CSS_FALLBACK',
} as const satisfies Record<LocatorObservation['source'], LocatorReasonCode>;

const RISK_REASON_CODES = {
  uuid: 'DYNAMIC_UUID',
  timestamp: 'DYNAMIC_TIMESTAMP',
  hash: 'DYNAMIC_HASH',
  numericSuffix: 'DYNAMIC_NUMERIC_SUFFIX',
  frameworkGenerated: 'FRAMEWORK_GENERATED',
  randomLooking: 'RANDOM_LOOKING',
} as const satisfies Record<IdentifierRisk, LocatorReasonCode>;

const RISK_PENALTIES = {
  uuid: LOCATOR_SCORE_ADJUSTMENTS.uuid,
  timestamp: LOCATOR_SCORE_ADJUSTMENTS.timestamp,
  hash: LOCATOR_SCORE_ADJUSTMENTS.hash,
  numericSuffix: LOCATOR_SCORE_ADJUSTMENTS.numericSuffix,
  frameworkGenerated: LOCATOR_SCORE_ADJUSTMENTS.frameworkGenerated,
  randomLooking: LOCATOR_SCORE_ADJUSTMENTS.randomLooking,
} as const satisfies Record<IdentifierRisk, number>;

function reason(code: LocatorReasonCode): LocatorReason {
  return {
    code,
    message: LOCATOR_REASON_MESSAGES[code],
  };
}

export interface ScoredLocator {
  candidate: LocatorCandidate;
  canonicalRiskCount: number;
  hasDynamicRisk: boolean;
  usesPositionalCss: boolean;
}

export function scoreLocatorObservation(
  observation: LocatorObservation,
): ScoredLocator | null {
  const unique = observation.matchCount === 1;
  if (!unique) {
    return null;
  }

  if (
    observation.source === 'text' &&
    isLikelySensitiveText(observation.stabilityValue)
  ) {
    return null;
  }

  const reasons: LocatorReason[] = [
    reason(SOURCE_REASON_CODES[observation.source]),
    reason('UNIQUE_MATCH'),
  ];
  let score =
    LOCATOR_BASE_SCORES[observation.source] + LOCATOR_SCORE_ADJUSTMENTS.unique;

  if (observation.source === 'role' || observation.source === 'label') {
    score += LOCATOR_SCORE_ADJUSTMENTS.semantic;
  }

  if (observation.stabilityValue.length <= 40) {
    score += LOCATOR_SCORE_ADJUSTMENTS.shortValue;
    reasons.push(reason('SHORT_VALUE'));
  }

  if (observation.source === 'text' && observation.stabilityValue.length > 40) {
    score += LOCATOR_SCORE_ADJUSTMENTS.longText;
  }

  const identifierRisks =
    observation.source === 'testId' ||
    observation.source === 'stableId' ||
    observation.source === 'stableName'
      ? detectIdentifierRisks(observation.stabilityValue)
      : [];
  const dynamicPenalty = Math.max(
    LOCATOR_SCORE_ADJUSTMENTS.dynamicMaximum,
    identifierRisks.reduce((total, risk) => total + RISK_PENALTIES[risk], 0),
  );
  score += dynamicPenalty;
  reasons.push(
    ...identifierRisks.map((risk) => reason(RISK_REASON_CODES[risk])),
  );

  const usesPositionalCss =
    observation.locator.kind === 'css' &&
    cssUsesPosition(observation.locator.selector);
  if (usesPositionalCss) {
    score += LOCATOR_SCORE_ADJUSTMENTS.positionalCss;
    reasons.push(reason('POSITIONAL_CSS'));
  }

  if (observation.locator.kind === 'css') {
    const depth = getCssDepth(observation.locator.selector);
    if (depth > 3) {
      score += Math.max(
        LOCATOR_SCORE_ADJUSTMENTS.cssDepthMaximum,
        (depth - 3) * LOCATOR_SCORE_ADJUSTMENTS.cssDepthStep,
      );
      reasons.push(reason('DEEP_CSS'));
    }

    if (looksLikeGeneratedClass(observation.locator.selector)) {
      score += LOCATOR_SCORE_ADJUSTMENTS.generatedClass;
      reasons.push(reason('GENERATED_CLASS'));
    }
  }

  return {
    candidate: {
      locator: observation.locator,
      score: Math.max(0, Math.min(100, score)),
      matchCount: 1,
      unique: true,
      source: observation.source,
      reasons,
    },
    canonicalRiskCount:
      identifierRisks.length +
      (usesPositionalCss ? 1 : 0) +
      (reasons.some((item) => item.code === 'GENERATED_CLASS') ? 1 : 0),
    hasDynamicRisk: identifierRisks.length > 0,
    usesPositionalCss,
  };
}
