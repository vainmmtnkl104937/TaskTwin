export type CanonicalJsonValue =
  | null
  | string
  | number
  | boolean
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite JSON number.');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError('Non-JSON value.');
  if (ancestors.has(value)) throw new TypeError('Circular JSON value.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => serialize(item, ancestors)).join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Canonical JSON requires plain objects.');
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serialize(record[key], ancestors)}`)
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function serializeLocalSecretCanonicalJson(value: unknown): string {
  return serialize(value, new Set<object>());
}
