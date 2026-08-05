import type { WorkflowActionIntent, WorkflowStep } from '@tasktwin/workflow-schema';

import type { ActionPolicyRule, OriginPattern } from './contracts.js';
import {
  normalizeCanonicalOrigin,
  normalizeHttpsDomain,
} from './origin-pattern.js';

export function originMatchesPattern(
  originInput: string,
  pattern: OriginPattern,
): boolean {
  let origin: string;
  try {
    origin = normalizeCanonicalOrigin(originInput);
  } catch {
    return false;
  }
  if (pattern.kind === 'exact') {
    return origin === normalizeCanonicalOrigin(pattern.origin);
  }
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.port !== '') return false;
  const hostname = url.hostname.toLowerCase();
  const domain = normalizeHttpsDomain(pattern.domain);
  return (
    (pattern.includeApex && hostname === domain) ||
    hostname.endsWith(`.${domain}`)
  );
}

export function ruleMatches(
  rule: ActionPolicyRule,
  input: {
    step: WorkflowStep;
    intent: WorkflowActionIntent;
    origin: string | null;
  },
): boolean {
  if (
    rule.match.stepTypes !== undefined &&
    !rule.match.stepTypes.includes(input.step.type)
  ) {
    return false;
  }
  if (
    rule.match.actionIntents !== undefined &&
    !rule.match.actionIntents.includes(input.intent)
  ) {
    return false;
  }
  if (rule.match.origins !== undefined) {
    return (
      input.origin !== null &&
      rule.match.origins.some((pattern) =>
        originMatchesPattern(input.origin!, pattern),
      )
    );
  }
  return true;
}
