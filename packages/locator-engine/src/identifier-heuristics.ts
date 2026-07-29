export type IdentifierRisk =
  | 'uuid'
  | 'timestamp'
  | 'hash'
  | 'numericSuffix'
  | 'frameworkGenerated'
  | 'randomLooking';

const UUID_PATTERN =
  /(?:^|[^0-9a-f])\{?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\}?(?:$|[^0-9a-f])/i;
const EPOCH_PATTERN = /^\d{10}(?:\d{3})?$/;
const DATE_PATTERN = /(?:^|[-_:])20\d{2}(?:[-_:]?\d{2}){2,5}(?:$|[-_:])/;
const HEX_HASH_PATTERN = /^[0-9a-f]{16,}$/i;
const TOKEN_HASH_PATTERN = /^(?=.*[a-z])(?=.*\d)[a-z0-9_-]{24,}$/i;
const NUMERIC_SUFFIX_PATTERN = /(?:[-_:]|\D)\d{4,}$/;
const FRAMEWORK_PATTERN =
  /^(?::r\d+:|ember\d+|(?:mat|mui|cdk|headlessui|radix)[-_:].*\d+|ng-\d+)|_ng(?:content|host)-/i;
const RANDOM_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9]{12,}$/;

export function detectIdentifierRisks(value: string): IdentifierRisk[] {
  const normalized = value.trim();
  const risks: IdentifierRisk[] = [];

  if (UUID_PATTERN.test(normalized)) {
    risks.push('uuid');
  }
  if (EPOCH_PATTERN.test(normalized) || DATE_PATTERN.test(normalized)) {
    risks.push('timestamp');
  }
  if (
    HEX_HASH_PATTERN.test(normalized) ||
    TOKEN_HASH_PATTERN.test(normalized)
  ) {
    risks.push('hash');
  }
  if (NUMERIC_SUFFIX_PATTERN.test(normalized)) {
    risks.push('numericSuffix');
  }
  if (FRAMEWORK_PATTERN.test(normalized)) {
    risks.push('frameworkGenerated');
  }
  if (RANDOM_PATTERN.test(normalized)) {
    risks.push('randomLooking');
  }

  return risks;
}

export function looksLikeGeneratedClass(selector: string): boolean {
  const classTokens = selector.match(/\.([A-Za-z_][A-Za-z0-9_-]*)/g) ?? [];
  return classTokens.some((token) => {
    const value = token.slice(1);
    return (
      detectIdentifierRisks(value).length > 0 ||
      /^(?:css|sc|jsx|styled)-[a-z0-9]{5,}$/i.test(value)
    );
  });
}

export function cssUsesPosition(selector: string): boolean {
  return /:(?:nth-child|nth-of-type)\s*\(/i.test(selector);
}

export function getCssDepth(selector: string): number {
  const normalized = selector
    .replace(/\[[^\]]*]/g, '')
    .replace(/\([^)]*\)/g, '');
  return normalized
    .split(/\s*>\s*|\s+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}
