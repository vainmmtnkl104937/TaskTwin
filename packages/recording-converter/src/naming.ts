import { sanitizePersistedText } from '@tasktwin/privacy-engine';
import type { RecordingTargetSnapshot } from '@tasktwin/recording-schema';

import {
  MAX_GENERATED_IDENTIFIER_LENGTH,
  MAX_GENERATED_STEP_NAME_LENGTH,
} from './constants.js';

const COMPLETE_URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/i;
const COMBINING_MARK_PATTERN = /\p{Mark}/gu;
const NON_IDENTIFIER_PART_PATTERN = /[^A-Za-z0-9]+/g;
const CAMEL_BOUNDARY_PATTERN = /([a-z0-9])([A-Z])/g;

function safeNamePart(value: string | null): string | null {
  const sanitized = sanitizePersistedText(
    value,
    MAX_GENERATED_STEP_NAME_LENGTH,
  );
  if (sanitized === null || COMPLETE_URL_PATTERN.test(sanitized)) {
    return null;
  }
  return sanitized;
}

export function getSafeTargetName(
  target: RecordingTargetSnapshot,
): string | null {
  const candidates = [
    target.labelText,
    target.accessibleName,
    target.placeholder,
    target.textPreview,
    target.name,
    target.id,
    ...target.testIdCandidates.map((candidate) => candidate.value),
  ];

  for (const candidate of candidates) {
    const safe = safeNamePart(candidate);
    if (safe !== null) {
      return safe;
    }
  }
  return null;
}

export function getSafeOptionLabel(value: string): string | null {
  return safeNamePart(value);
}

export function createStepName(
  action: 'click' | 'fill' | 'select' | 'enable' | 'disable',
  targetName: string | null,
  optionLabel?: string | null,
): string {
  const fallback = {
    click: 'control',
    fill: 'field',
    select: 'field',
    enable: 'control',
    disable: 'control',
  } as const;
  const subject = targetName ?? fallback[action];

  const generated =
    action === 'select' && optionLabel !== undefined && optionLabel !== null
      ? `Select ${optionLabel} in ${subject}`
      : `${action[0]!.toUpperCase()}${action.slice(1)} ${subject}`;

  return generated.slice(0, MAX_GENERATED_STEP_NAME_LENGTH).trim();
}

export function toSafeIdentifier(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(COMBINING_MARK_PATTERN, '')
    .replace(CAMEL_BOUNDARY_PATTERN, '$1 $2')
    .replace(NON_IDENTIFIER_PART_PATTERN, ' ')
    .trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '';
  }

  const [first, ...rest] = words;
  const identifier = [
    first!.toLowerCase(),
    ...rest.map(
      (word) => `${word[0]!.toUpperCase()}${word.slice(1).toLowerCase()}`,
    ),
  ].join('');
  const prefixed = /^\d/.test(identifier) ? `value${identifier}` : identifier;
  return prefixed.slice(0, MAX_GENERATED_IDENTIFIER_LENGTH);
}

export function allocateIdentifier(
  preferred: string,
  fallback: string,
  used: Set<string>,
): string {
  const normalizedPreferred = toSafeIdentifier(preferred);
  const base = normalizedPreferred === '' ? fallback : normalizedPreferred;
  let candidate = base.slice(0, MAX_GENERATED_IDENTIFIER_LENGTH);
  let suffix = 2;

  while (used.has(candidate)) {
    const suffixText = String(suffix);
    candidate = `${base.slice(
      0,
      MAX_GENERATED_IDENTIFIER_LENGTH - suffixText.length,
    )}${suffixText}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}
