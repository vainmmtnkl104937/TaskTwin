import type { JsonValue } from './json-types.js';
import {
  OriginPatternSchema,
  WorkspaceExecutionPolicyDefinitionSchema,
  type ActionPolicyRule,
  type OriginPattern,
  type WorkspaceExecutionPolicyDefinition,
} from './contracts.js';
import {
  normalizeCanonicalOrigin,
  normalizeHttpsDomain,
} from './origin-pattern.js';

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function canonicalizeOriginPattern(input: unknown): OriginPattern {
  const pattern = OriginPatternSchema.parse(input);
  if (pattern.kind === 'exact') {
    return { kind: 'exact', origin: normalizeCanonicalOrigin(pattern.origin) };
  }
  return {
    kind: 'https_subdomains',
    patternVersion: 1,
    domain: normalizeHttpsDomain(pattern.domain),
    includeApex: pattern.includeApex,
  };
}

export function originPatternKey(pattern: OriginPattern): string {
  return pattern.kind === 'exact'
    ? `exact:${pattern.origin}`
    : `https_subdomains:${pattern.domain}:${pattern.includeApex ? '1' : '0'}`;
}

function canonicalizePatterns(values: readonly OriginPattern[]): OriginPattern[] {
  const byKey = new Map<string, OriginPattern>();
  values.forEach((value) => {
    const pattern = canonicalizeOriginPattern(value);
    byKey.set(originPatternKey(pattern), pattern);
  });
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

function canonicalizeRule(rule: ActionPolicyRule): ActionPolicyRule {
  return {
    id: rule.id,
    match: {
      ...(rule.match.stepTypes === undefined
        ? {}
        : { stepTypes: uniqueSorted(rule.match.stepTypes) }),
      ...(rule.match.actionIntents === undefined
        ? {}
        : { actionIntents: uniqueSorted(rule.match.actionIntents) }),
      ...(rule.match.origins === undefined
        ? {}
        : { origins: canonicalizePatterns(rule.match.origins) }),
    },
    ...(rule.minimumRisk === undefined
      ? {}
      : { minimumRisk: rule.minimumRisk }),
    ...(rule.decision === undefined ? {} : { decision: rule.decision }),
  };
}

export function canonicalizePolicyDefinition(
  input: unknown,
): WorkspaceExecutionPolicyDefinition {
  const policy = WorkspaceExecutionPolicyDefinitionSchema.parse(input);
  return WorkspaceExecutionPolicyDefinitionSchema.parse({
    schemaVersion: 1,
    network: {
      mode: policy.network.mode,
      allowedOrigins: canonicalizePatterns(policy.network.allowedOrigins),
      blockedOrigins: canonicalizePatterns(policy.network.blockedOrigins),
      allowLoopbackHttp: policy.network.allowLoopbackHttp,
    },
    unknownActionRisk: policy.unknownActionRisk,
    approval: policy.approval,
    rules: policy.rules
      .map(canonicalizeRule)
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

export function serializeCanonicalJson(value: JsonValue): string {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('Canonical JSON cannot contain non-finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(serializeCanonicalJson).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${serializeCanonicalJson(value[key] as JsonValue)}`,
    )
    .join(',')}}`;
}

export function canonicalPolicyJson(input: unknown): string {
  return serializeCanonicalJson(
    canonicalizePolicyDefinition(input) as unknown as JsonValue,
  );
}
