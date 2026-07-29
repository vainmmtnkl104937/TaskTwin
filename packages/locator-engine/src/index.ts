export {
  MAX_CSS_SELECTOR_LENGTH,
  MAX_LOCATOR_CANDIDATES,
  MAX_LOCATOR_FALLBACKS,
  MAX_LOCATOR_VALUE_LENGTH,
  MAX_TEST_ID_LENGTH,
  MAX_VISIBLE_TEXT_LENGTH,
  LOCATOR_BASE_SCORES,
  LOCATOR_SCORE_ADJUSTMENTS,
  LOCATOR_SOURCE_PRIORITY,
} from './constants.js';

export {
  LOCATOR_REASON_MESSAGES,
  LocatorBundleSchema,
  LocatorCandidateSchema,
  LocatorConfidenceSchema,
  LocatorObservationListSchema,
  LocatorObservationSchema,
  LocatorReasonCodeSchema,
  LocatorReasonSchema,
  LocatorSourceSchema,
} from './contracts.js';
export type {
  LocatorBundle,
  LocatorCandidate,
  LocatorConfidence,
  LocatorObservation,
  LocatorReason,
  LocatorReasonCode,
  LocatorSource,
} from './contracts.js';

export { canonicalizeLocator } from './canonical-locator.js';
export { calculateLocatorConfidence } from './confidence.js';
export {
  cssUsesPosition,
  detectIdentifierRisks,
  getCssDepth,
  looksLikeGeneratedClass,
} from './identifier-heuristics.js';
export type { IdentifierRisk } from './identifier-heuristics.js';
export { rankLocatorBundle } from './ranking.js';
export type { RankLocatorBundleResult } from './ranking.js';
export { scoreLocatorObservation } from './scoring.js';
export { isLikelySensitiveText } from './text-heuristics.js';
