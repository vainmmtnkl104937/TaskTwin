const EMAIL_PATTERN = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/i;
const OTP_PATTERN = /^\d{4,8}$/;
const LONG_NUMBER_PATTERN = /(?:\d[\s-]?){13,19}/;
const TOKEN_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]{20,}$/;

export function isLikelySensitiveText(value: string): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return (
    EMAIL_PATTERN.test(normalized) ||
    URL_PATTERN.test(normalized) ||
    OTP_PATTERN.test(normalized) ||
    LONG_NUMBER_PATTERN.test(normalized) ||
    TOKEN_PATTERN.test(normalized)
  );
}
