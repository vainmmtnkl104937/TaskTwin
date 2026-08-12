const REDACTED = '[REDACTED]';
const MAXIMUM_STRING_LENGTH = 512;
const MAXIMUM_ARRAY_LENGTH = 20;
const MAXIMUM_DEPTH = 4;

const SENSITIVE_KEY =
  /(?:authorization|cookie|password|secret|token|credential|lease|runtime(?:input|value)?|privatekey|plaintext|protectedkey)/iu;
const SENSITIVE_TEXT =
  /(?:bearer|tasktwinrunner)\s+[a-z0-9._~+/=-]+|x-tasktwin-run-lease\s*[:=]\s*[^\s,;]+/giu;

function redactString(value: string): string {
  const redacted = value.replace(SENSITIVE_TEXT, REDACTED);
  return redacted.length <= MAXIMUM_STRING_LENGTH
    ? redacted
    : `${redacted.slice(0, MAXIMUM_STRING_LENGTH)}…`;
}

export function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth >= MAXIMUM_DEPTH) return '[TRUNCATED]';
  if (typeof value === 'string') return redactString(value);
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === undefined
  ) {
    return value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: 'ERROR_REDACTED' };
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAXIMUM_ARRAY_LENGTH)
      .map((item) => redactLogValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value).slice(
      0,
      MAXIMUM_ARRAY_LENGTH,
    )) {
      result[key] = SENSITIVE_KEY.test(key)
        ? REDACTED
        : redactLogValue(entry, depth + 1);
    }
    return result;
  }
  return String(value);
}
