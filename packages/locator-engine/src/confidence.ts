import type { LocatorCandidate, LocatorConfidence } from './contracts.js';

function hasReason(
  candidate: LocatorCandidate,
  code:
    | 'DYNAMIC_UUID'
    | 'DYNAMIC_TIMESTAMP'
    | 'DYNAMIC_HASH'
    | 'DYNAMIC_NUMERIC_SUFFIX'
    | 'FRAMEWORK_GENERATED'
    | 'RANDOM_LOOKING'
    | 'POSITIONAL_CSS'
    | 'GENERATED_CLASS',
): boolean {
  return candidate.reasons.some((reason) => reason.code === code);
}

function hasSevereRisk(candidate: LocatorCandidate): boolean {
  return (
    hasReason(candidate, 'DYNAMIC_UUID') ||
    hasReason(candidate, 'DYNAMIC_TIMESTAMP') ||
    hasReason(candidate, 'DYNAMIC_HASH') ||
    hasReason(candidate, 'FRAMEWORK_GENERATED') ||
    hasReason(candidate, 'RANDOM_LOOKING') ||
    hasReason(candidate, 'POSITIONAL_CSS') ||
    hasReason(candidate, 'GENERATED_CLASS')
  );
}

export function calculateLocatorConfidence(
  primary: LocatorCandidate,
  fallbacks: readonly LocatorCandidate[],
): LocatorConfidence {
  const hasStrongFallback = fallbacks.some(
    (candidate) => candidate.score >= 70 && !hasSevereRisk(candidate),
  );

  if (primary.score >= 90 && !hasSevereRisk(primary) && hasStrongFallback) {
    return 'high';
  }

  if (
    primary.score >= 65 &&
    !hasSevereRisk(primary) &&
    primary.source !== 'css'
  ) {
    return 'medium';
  }

  return 'low';
}
