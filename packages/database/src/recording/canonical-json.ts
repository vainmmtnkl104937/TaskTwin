import { createHash } from 'node:crypto';

function serializeCanonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON cannot contain a non-finite number');
    }

    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(serializeCanonicalJson).join(',')}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serializeCanonicalJson(record[key])}`,
      );
    return `{${entries.join(',')}}`;
  }

  throw new TypeError('Canonical JSON received a non-JSON value');
}

export function createCanonicalJsonDigest(value: unknown): string {
  return createHash('sha256')
    .update(serializeCanonicalJson(value), 'utf8')
    .digest('hex');
}
