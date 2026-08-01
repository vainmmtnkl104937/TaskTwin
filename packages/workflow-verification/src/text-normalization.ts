import { MAX_VERIFICATION_TEXT_LENGTH } from './constants.js';

export function normalizeVerificationText(input: string): string | null {
  if (input.length > MAX_VERIFICATION_TEXT_LENGTH) {
    return null;
  }
  return input.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export function compareVerificationText(
  actual: string,
  expected: string,
  matchMode: 'exact' | 'contains',
): boolean {
  const left = normalizeVerificationText(actual);
  const right = normalizeVerificationText(expected);
  if (left === null || right === null) return false;
  return matchMode === 'exact' ? left === right : left.includes(right);
}

export function compareVerificationFieldValue(
  actual: string,
  expected: string | number | boolean,
): boolean {
  if (actual.length > MAX_VERIFICATION_TEXT_LENGTH) return false;
  return actual === String(expected);
}
